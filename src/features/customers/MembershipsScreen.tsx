import { downloadPdf } from '../../shared/utils/exportFile';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { collection, doc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { auth, db } from '../../lib/firebase/client';
import { useAppTheme } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { TextField } from '../../shared/components/TextField';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import type { AgreementRecord, MembershipPlan, MembershipRecord, TenantRecord } from '../../shared/types/records';
import { money } from '../../shared/utils/money';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { getDayKey, getMonthKey, shiftMonth } from '../operations/operationsMath';
import { parseAmount } from '../money/financeMath';
import { FilterPill } from './FilterPill';
import { syncAllocationGuard } from './allocationTransactions';
import { escapeDocumentText, membershipPeriod, membershipStatus } from './membershipMath';

export function MembershipsScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { settings, can, isAdmin } = useBusinessSettings();
  const tenants = useFirestoreCollection<TenantRecord>('tenants');
  const plans = useFirestoreCollection<MembershipPlan>('membershipPlans');
  const memberships = useFirestoreCollection<MembershipRecord>('memberships', { sortBy: 'createdAt' });
  const agreements = useFirestoreCollection<AgreementRecord>('agreements', { sortBy: 'createdAt' });
  const [tenantId, setTenantId] = useState('');
  const [planId, setPlanId] = useState('');
  const [planName, setPlanName] = useState('');
  const [planMonths, setPlanMonths] = useState('1');
  const [planFee, setPlanFee] = useState('');
  const [start, setStart] = useState(`${getMonthKey()}-01`);
  const [seat, setSeat] = useState('');
  const [terms, setTerms] = useState('');
  const [acceptanceName, setAcceptanceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tenant = tenants.data.find((item) => item.id === tenantId);
  const plan = plans.data.find((item) => item.id === planId);
  const loading = [tenants, plans, memberships, agreements].some((item) => item.loading);
  const loadError = [tenants, plans, memberships, agreements].find((item) => item.error)?.error;
  const memberHistory = memberships.data.filter((item) => item.tenantId === tenantId);
  const latestMembership = [...memberHistory].sort((a, b) => b.end.localeCompare(a.end))[0];
  const card = { backgroundColor: colors.surface, padding: 16, borderRadius: 16, gap: 12, marginBottom: 16 };
  const text = { color: colors.text };
  async function perform(action: (uid: string) => Promise<void>) {
    if (loading || loadError) return setMessage('Wait for records to load successfully.');
    const uid = auth.currentUser?.uid;
    if (!uid) return setMessage('Please sign in again.');
    setBusy(true); setMessage('');
    try { await action(uid); setMessage('Saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); } finally { setBusy(false); }
  }
  function savePlan() {
    return perform(async (uid) => {
      const months = Number(planMonths), monthlyFee = parseAmount(planFee, true);
      if (!planName.trim() || planName.length > 120 || !Number.isInteger(months) || months < 1 || months > 12) throw new Error('Enter a plan name and a duration of 1–12 months.');
      const batch = writeBatch(db), ref = doc(collection(db, 'membershipPlans'));
      batch.set(ref, { name: planName.trim(), months, monthlyFee, active: true, createdAt: serverTimestamp(), createdBy: uid });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'membership.plan_created', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'membership_plan' });
      await batch.commit(); setPlanId(ref.id); setPlanName(''); setPlanFee('');
    });
  }
  function renew() {
    return perform(async (uid) => {
      if (!can('money')) throw new Error('Membership renewal requires customer and money permissions.');
      if (!tenant || tenant.businessType !== 'library' || !plan?.active) throw new Error('Select a library customer and an active plan.');
      if (!['active', 'checked in', 'occupied'].includes(String(tenant.status).toLowerCase())) throw new Error('Activate the customer before creating a membership.');
      const period = membershipPeriod(start, plan.months);
      if (period.end < getDayKey()) throw new Error('Choose a membership period that has not expired.');
      if (!seat.trim()) throw new Error('Enter the library seat.');
      const next = { ...tenant, room: seat.trim().toUpperCase(), moveOutDate: period.end, moveOutTime: '23:59', membershipManaged: true, membershipEnd: period.end };
      const ref = doc(collection(db, 'memberships'));
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(doc(db, 'tenants', tenant.id));
        const currentPlan = await transaction.get(doc(db, 'membershipPlans', plan.id));
        const closed = await transaction.get(doc(db, 'settlements', tenant.id));
        if (closed.exists() || !latest.exists()) throw new Error('This customer cannot be renewed.');
        if (currentPlan.data()?.active !== true || currentPlan.data()?.monthlyFee !== plan.monthlyFee || currentPlan.data()?.months !== plan.months) throw new Error('Plan changed. Refresh before renewing.');
        if (latest.data().membershipEnd && period.start <= latest.data().membershipEnd) throw new Error('Membership overlaps an existing period. Start after its expiry.');
        for (const month of period.invoiceMonths) {
          const invoice = await transaction.get(doc(db, 'invoices', `${tenant.id}_${month}`));
          if (invoice.exists()) throw new Error(`A final bill already exists for ${month}. Start with an unbilled month.`);
        }
        await syncAllocationGuard(transaction, tenant.id, tenant, next, tenants.data);
        transaction.update(doc(db, 'tenants', tenant.id), { room: next.room, moveOutDate: next.moveOutDate, moveOutTime: next.moveOutTime, membershipManaged: true, membershipStart: latest.data().membershipStart || period.start, membershipEnd: period.end, membershipId: ref.id, updatedAt: serverTimestamp() });
        transaction.set(ref, { ...period, tenantId: tenant.id, tenantName: tenant.fullName || tenant.name || '', planId: plan.id, planName: plan.name, monthlyFee: plan.monthlyFee, seat: next.room, createdAt: serverTimestamp(), createdBy: uid });
        for (const month of period.invoiceMonths) transaction.set(doc(db, 'invoices', `${tenant.id}_${month}`), { membershipId: ref.id, baseAmount: plan.monthlyFee, businessType: 'library', issuedAt: serverTimestamp(), issuedBy: uid, meterAmount: 0, month, dueDate: `${month}-10`, status: 'Issued', tenantId: tenant.id, tenantName: tenant.fullName || tenant.name || '', tenantRoom: next.room, total: plan.monthlyFee });
        transaction.set(doc(collection(db, 'auditEvents')), { action: 'membership.renewed', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'membership' });
      });
    });
  }
  function createAgreement() {
    return perform(async (uid) => {
      if (!tenant || !terms.trim() || terms.length > 10000) throw new Error('Select a customer and enter agreement terms up to 10,000 characters.');
      const ref = doc(collection(db, 'agreements')), batch = writeBatch(db);
      batch.set(ref, { tenantId: tenant.id, tenantName: tenant.fullName || tenant.name || '', businessName: settings.name, address: settings.address, room: tenant.room || '', fee: Number(tenant.membershipManaged ? latestMembership?.monthlyFee || 0 : tenant.rent || 0), start: tenant.moveInDate || '', end: tenant.moveOutDate || '', terms: terms.trim(), status: 'Draft', createdAt: serverTimestamp(), createdBy: uid });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'agreement.created', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'agreement' });
      await batch.commit(); setTerms('');
    });
  }
  async function acceptAgreement(agreement: AgreementRecord) {
    return perform(async (uid) => {
      if (!acceptanceName.trim() || acceptanceName.length > 120) throw new Error('Enter the name of the customer who accepted the signed agreement.');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo library permission is required.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled) throw new Error('Signed document photo was not selected.');
      const context = ImageManipulator.manipulate(result.assets[0].uri); context.resize({ width: 1280 });
      const rendered = await context.renderAsync();
      const optimized = await rendered.saveAsync({ base64: true, compress: 0.65, format: SaveFormat.JPEG });
      if (!optimized.base64 || optimized.base64.length > 600000) throw new Error('Signed photo is too large. Crop it and try again.');
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'agreements', agreement.id), current = await transaction.get(ref);
        if (current.data()?.status !== 'Draft') throw new Error('Agreement is already accepted. Create a new version for changes.');
        transaction.update(ref, { status: 'Accepted', signedPhoto: `data:image/jpeg;base64,${optimized.base64}`, acceptedAt: serverTimestamp(), acceptedBy: uid, acceptanceName: acceptanceName.trim() });
        transaction.set(doc(collection(db, 'auditEvents')), { action: 'agreement.accepted', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'agreement' });
      });
    });
  }
  function exportAgreement(agreement: AgreementRecord) {
    return perform(async () => {
      const escape = escapeDocumentText;
      await downloadPdf({ fileName: `agreement-${agreement.id}.pdf`, title: 'Agreement', html: `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;padding:32px;font-size:14px}pre{white-space:pre-wrap;font-family:inherit;line-height:1.6}img{max-width:100%;page-break-before:always}</style></head><body><h1>${escape(agreement.businessName)}</h1><p>${escape(agreement.address)}</p><h2>Customer agreement</h2><p>Agreement: ${escape(agreement.id)} · ${escape(agreement.status)}</p><p>Customer: ${escape(agreement.tenantName)} · Allocation: ${escape(agreement.room)}</p><p>Period: ${escape(agreement.start)} – ${escape(agreement.end)} · Fee: ${escape(money(agreement.fee))}</p><pre>${escape(agreement.terms)}</pre><p>Customer signature: ___________________</p><p>Business signature: ___________________</p>${agreement.status === 'Accepted' ? `<p>Accepted by ${escape(agreement.acceptanceName)}; recorded by ${escape(agreement.acceptedBy)} on ${escape(agreement.acceptedAt?.seconds ? new Date(agreement.acceptedAt.seconds * 1000).toLocaleString('en-IN') : '')}</p><img src="${escape(agreement.signedPhoto)}" alt="Signed agreement">` : ''}</body></html>` });
    });
  }
  return <View>
    <Text style={{ ...text, fontSize: 24 }}>{t('Memberships & agreements')}</Text>
    {message || loadError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, marginVertical: 12 }}>{t(message || loadError || '')}</Text> : null}
    {loading ? <Text style={text}>{t('Loading...')}</Text> : null}
    {isAdmin ? <View style={card}><Text style={text}>{t('Create library membership plan')}</Text>
      <TextField label="Plan name" value={planName} onChangeText={setPlanName} maxLength={120} />
      <TextField label="Duration in calendar months (1–12)" value={planMonths} onChangeText={setPlanMonths} keyboardType="number-pad" />
      <TextField label="Monthly membership fee" value={planFee} onChangeText={setPlanFee} keyboardType="decimal-pad" />
      <PrimaryButton label="Save plan" onPress={savePlan} loading={busy || loading} />
      {plans.data.map((item) => <View key={item.id}><Text style={text}>{item.name} · {item.months} {t('months')} · {money(item.monthlyFee)} / {t('month')} · {t(item.active ? 'Active' : 'Inactive')}</Text>{item.active ? <PrimaryButton label="Retire plan" loading={busy} onPress={() => perform(async (uid) => { const batch = writeBatch(db); batch.update(doc(db, 'membershipPlans', item.id), { active: false }); batch.set(doc(collection(db, 'auditEvents')), { action: 'membership.plan_retired', actorUid: uid, createdAt: serverTimestamp(), entityId: item.id, entityType: 'membership_plan' }); await batch.commit(); })} /> : null}</View>)}
    </View> : null}
    <View style={card}><Text style={text}>{t('Customer')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{tenants.data.filter((item) => !item.archived).map((item) => <FilterPill key={item.id} label={`${item.fullName || item.name} · ${item.room || ''}`} active={tenantId === item.id} onPress={() => { setTenantId(item.id); setSeat(item.room || ''); const history = memberships.data.filter((member) => member.tenantId === item.id).sort((a, b) => b.end.localeCompare(a.end)); setStart(history[0] ? `${shiftMonth(history[0].end.slice(0, 7), 1)}-01` : `${getMonthKey()}-01`); }} />)}</View>
      {tenant?.businessType === 'library' ? <>
        <Text style={text}>{t('Memberships cover whole calendar months. Each month is billed at the saved plan price; renewals must not overlap. Expiry releases the dated seat reservation.')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{plans.data.filter((item) => item.active).map((item) => <FilterPill key={item.id} label={`${item.name} · ${money(item.monthlyFee)}`} active={planId === item.id} onPress={() => setPlanId(item.id)} />)}</View>
        <TextField label="Start date (YYYY-MM-01)" value={start} onChangeText={setStart} />
        <TextField label="Library seat" value={seat} onChangeText={setSeat} autoCapitalize="characters" maxLength={10} />
        {can('money') ? <PrimaryButton label="Start / renew membership" onPress={renew} loading={busy || loading} /> : <Text style={text}>{t('Money permission is required to issue membership bills.')}</Text>}
        {memberHistory.map((item) => <Text key={item.id} style={text}>{item.planName} · {item.start} – {item.end} · {item.seat} · {money(item.monthlyFee)} / {t('month')} · {t(item.start > getDayKey() ? 'Upcoming' : membershipStatus(item.end))}</Text>)}
      </> : null}
    </View>
    <View style={card}><Text style={text}>{t('Agreement versions')}</Text><Text style={text}>{t('Enter your approved terms. Each version keeps its customer, fee, dates and terms. Attach a readable photo of the signed document to record acceptance.')}</Text>
      <TextField label="Agreement terms" value={terms} onChangeText={setTerms} multiline maxLength={10000} />
      <PrimaryButton label="Create agreement version" onPress={createAgreement} loading={busy || loading} />
      <TextField label="Customer acceptance name" value={acceptanceName} onChangeText={setAcceptanceName} maxLength={120} />
      {agreements.data.filter((item) => item.tenantId === tenantId).map((item) => <View key={item.id} style={{ gap: 8, marginTop: 12 }}><Text style={text}>{item.tenantName} · {item.start} – {item.end} · {t(item.status)} · {item.id.slice(-8)}</Text><Text selectable style={text}>{item.terms}</Text>
        <PrimaryButton label="Download agreement PDF" onPress={() => exportAgreement(item)} loading={busy} />
        {item.status === 'Draft' ? <PrimaryButton label="Attach signed photo and record acceptance" onPress={() => acceptAgreement(item)} loading={busy} /> : <><Text style={text}>{t('Accepted by')}: {item.acceptanceName} · {item.acceptedAt?.seconds ? new Date(item.acceptedAt.seconds * 1000).toLocaleString('en-IN') : ''}</Text><Image source={{ uri: item.signedPhoto }} resizeMode="contain" style={{ width: '100%', height: 360 }} accessibilityLabel="Signed agreement document" /></>}
      </View>)}
    </View>
    <View style={card}><Text style={text}>{t('Expiry tracking')}</Text>{memberships.data.filter((item) => item.end >= getDayKey()).sort((a, b) => a.end.localeCompare(b.end)).map((item) => <Text key={item.id} style={text}>{item.tenantName} · {item.end} · {t(item.start > getDayKey() ? 'Upcoming' : membershipStatus(item.end))}</Text>)}{memberships.data.filter((item) => item.end < getDayKey() && !memberships.data.some((other) => other.tenantId === item.tenantId && other.end > item.end)).map((item) => <Text key={item.id} style={{ color: colors.danger }}>{item.tenantName} · {t('Expired')} · {item.end}</Text>)}</View>
  </View>;
}
