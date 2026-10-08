import { useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase/client';
import { useAppTheme } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { TextField } from '../../shared/components/TextField';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useRealtimeClock } from '../../shared/hooks/useRealtimeClock';
import type { EnquiryRecord, FirestoreRecord, InvoiceRecord, MembershipRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, SupportRequestRecord, TenantRecord, WorkItem } from '../../shared/types/records';
import { money } from '../../shared/utils/money';
import { FilterPill } from '../customers/FilterPill';
import { getRoomNumbers } from '../customers/businessConfig';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { getDayKey } from './operationsMath';
import { expiringMemberships, outstandingRows, pendingEnquiries, reminderMessage, validDay } from './workMath';

const kinds: WorkItem['kind'][] = ['maintenance', 'housekeeping', 'follow_up', 'reminder'];
const statusLabels = { open: 'Open', in_progress: 'In progress', done: 'Done' };
export function WorkDesk() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { settings, isAdmin } = useBusinessSettings();
  const today = getDayKey(new Date(useRealtimeClock()));
  const work = useFirestoreCollection<WorkItem>('workItems', { sortBy: 'createdAt' });
  const tenants = useFirestoreCollection<TenantRecord>('tenants');
  const payments = useFirestoreCollection<PaymentRecord>('payments');
  const readings = useFirestoreCollection<MeterReadingRecord>('meterReadings');
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices');
  const settlements = useFirestoreCollection<SettlementRecord>('settlements');
  const memberships = useFirestoreCollection<MembershipRecord>('memberships');
  const enquiries = useFirestoreCollection<EnquiryRecord>('enquiries');
  const requests = useFirestoreCollection<SupportRequestRecord>('supportRequests');
  const people = useFirestoreCollection<FirestoreRecord>('users', { enabled: isAdmin });
  const [kind, setKind] = useState<WorkItem['kind']>('maintenance');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [allocation, setAllocation] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedName, setAssignedName] = useState('');
  const [filter, setFilter] = useState('open');
  const [kindFilter, setKindFilter] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [reschedule, setReschedule] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sources = [work, tenants, payments, readings, invoices, settlements, memberships, enquiries, requests, people];
  const loading = sources.some((item) => item.loading), error = sources.find((item) => item.error)?.error;
  const arrears = outstandingRows(tenants.data, payments.data, readings.data, invoices.data, settlements.data, today).filter((item) => item.overdue > 0);
  const renewals = expiringMemberships(memberships.data, today);
  const leads = pendingEnquiries(enquiries.data, today);
  const card = { padding: 16, borderRadius: 16, marginBottom: 16, backgroundColor: colors.surface, gap: 10 };
  const text = { color: colors.text };
  async function perform(action: (uid: string) => Promise<void>) {
    if (loading || error) return setMessage('Wait for records to load successfully.');
    const uid = auth.currentUser?.uid;
    if (!uid) return setMessage('Please sign in again.');
    setBusy(true); setMessage('');
    try { await action(uid); setMessage('Saved.'); } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Could not save.'); } finally { setBusy(false); }
  }
  const audit = (uid: string, id: string, action: string) => ({ action, actorUid: uid, entityId: id, entityType: 'work_item', createdAt: serverTimestamp() });
  function draft(uid: string, itemTitle = title, itemAllocation = allocation, itemKind = kind): Omit<WorkItem, 'id'> {
    if (!itemTitle.trim() || itemTitle.length > 160 || !validDay(date) || itemAllocation.length > 80) throw new Error('Enter a title, valid due date and allocation up to 80 characters.');
    const customer = tenants.data.find((item) => item.id === customerId);
    if (customerId && !customer) throw new Error('Select an existing customer.');
    const request = requests.data.find((item) => item.id === requestId);
    if (requestId && (!request || request.customerId !== customerId)) throw new Error('Select the customer linked to this request.');
    return { kind: itemKind, title: itemTitle.trim(), dueDate: date, allocation: itemAllocation.trim(), customerId, customerName: customer?.fullName || customer?.name || '', supportRequestId: requestId, assignedTo, assignedName, status: 'open', outcome: '', revision: 1, createdBy: uid, updatedBy: uid };
  }
  function createWork() {
    return perform(async (uid) => {
      const data = draft(uid), ref = doc(collection(db, 'workItems'));
      await runTransaction(db, async (transaction) => {
        transaction.set(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        transaction.set(doc(collection(db, 'auditEvents')), audit(uid, ref.id, 'work_item.created'));
      });
      setTitle(''); setRequestId('');
    });
  }
  function cleaningChecklist() {
    return perform(async (uid) => {
      if (!validDay(date)) throw new Error('Enter a valid due date.');
      const rooms = getRoomNumbers(settings);
      let created = 0;
      // ponytail: generate in 40-room atomic batches; retries skip existing room/day tasks.
      for (let offset = 0; offset < rooms.length; offset += 40) {
        const group = rooms.slice(offset, offset + 40);
        await runTransaction(db, async (transaction) => {
          const refs = group.map((room) => doc(db, 'workItems', `cleaning_${date}_${room}`));
          const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
          const missing = snapshots.map((snapshot, index) => snapshot.exists() ? -1 : index).filter((index) => index >= 0);
          missing.forEach((index) => transaction.set(refs[index], { kind: 'housekeeping', title: 'Daily room cleaning', dueDate: date, allocation: `Room ${group[index]}`, customerId: '', customerName: '', supportRequestId: '', assignedTo, assignedName, status: 'open', outcome: '', revision: 1, createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
          if (missing.length) transaction.set(doc(collection(db, 'auditEvents')), audit(uid, `${date}_${offset}`, 'work_item.created'));
          // Count only the committed attempt, including transaction retries.
          return missing.length;
        }).then((count) => { created += count; });
      }
      setMessage(`${created} ${t('cleaning tasks created. Existing tasks were kept.')}`);
    });
  }
  function updateWork(item: WorkItem, status: WorkItem['status'], newDate = item.dueDate) {
    return perform(async (uid) => {
      const outcome = outcomes[item.id]?.trim() || item.outcome;
      if ((status === 'done' && !outcome) || outcome.length > 2000 || !validDay(newDate)) throw new Error('Enter a valid due date and an outcome before completing work.');
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'workItems', item.id), latest = await transaction.get(ref);
        if (latest.data()?.revision !== item.revision || latest.data()?.status === 'done') throw new Error('This task changed. Refresh before continuing.');
        transaction.update(ref, { status, dueDate: newDate, outcome, revision: item.revision + 1, updatedAt: serverTimestamp(), updatedBy: uid });
        transaction.set(doc(collection(db, 'auditEvents')), audit(uid, item.id, status === 'done' ? 'work_item.completed' : 'work_item.updated'));
      });
    });
  }
  function contact(phone: unknown, name: string, detail: string, channel: 'whatsapp' | 'sms') {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `91${digits}`;
    if (digits.length < 8 || digits.length > 15) return setMessage('A valid customer phone number is required.');
    const body = encodeURIComponent(reminderMessage(settings.name, name, detail));
    Linking.openURL(channel === 'whatsapp' ? `https://wa.me/${digits}?text=${body}` : `sms:+${digits}${Platform.OS === 'ios' ? '&' : '?'}body=${body}`).catch(() => setMessage('Could not open the messaging app.'));
  }
  const contactButtons = (phone: unknown, name: string, detail: string) => <View style={{ gap: 8 }}><PrimaryButton label="Prepare WhatsApp reminder" onPress={() => contact(phone, name, detail, 'whatsapp')} /><PrimaryButton label="Prepare SMS reminder" onPress={() => contact(phone, name, detail, 'sms')} /></View>;
  function prepareFollowUp(id: string, name: string, taskTitle: string) { setCustomerId(id); setRequestId(''); setTitle(taskTitle); setKind('follow_up'); setAllocation(tenants.data.find((item) => item.id === id)?.room || ''); }
  return <View>
    <Text style={{ ...text, fontSize: 24 }}>{t('Daily work')}</Text>
    <Text style={{ color: colors.muted, marginVertical: 12 }}>{t('Review the queue, prepare reminders, and record the outcome. Messages are sent only when you confirm in your messaging app.')}</Text>
    {message || error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, marginBottom: 12 }}>{message || error}</Text> : null}
    {loading ? <Text style={text}>{t('Loading...')}</Text> : null}
    <View style={card}><Text style={text}>{t('Overdue payments')}: {arrears.length}</Text>{arrears.map((item) => <View key={item.tenant.id} style={{ gap: 8 }}><Text style={text}>{item.tenant.fullName || item.tenant.name} · {money(item.overdue)} · {item.oldestDueDate} · {item.overdueDays} {t('days overdue')}</Text>{contactButtons(item.tenant.phone, item.tenant.fullName || item.tenant.name || '', `${money(item.overdue)} is overdue since ${item.oldestDueDate}`)}<PrimaryButton label="Schedule follow-up" onPress={() => prepareFollowUp(item.tenant.id, item.tenant.name || '', `Payment follow-up: ${item.tenant.fullName || item.tenant.name}`)} /></View>)}</View>
    <View style={card}><Text style={text}>{t('Membership renewals')}: {renewals.length}</Text>{renewals.map((item) => { const tenant = tenants.data.find((row) => row.id === item.tenantId); return <View key={item.id} style={{ gap: 8 }}><Text style={text}>{item.tenantName} · {item.planName} · {item.end}</Text>{contactButtons(tenant?.phone, item.tenantName, `your membership ends on ${item.end}`)}<PrimaryButton label="Schedule follow-up" onPress={() => prepareFollowUp(item.tenantId, item.tenantName, `Membership renewal: ${item.tenantName}`)} /></View>; })}</View>
    <View style={card}><Text style={text}>{t('Enquiry follow-ups')}: {leads.length}</Text>{leads.map((item) => <View key={item.id} style={{ gap: 8 }}><Text style={text}>{item.name} · {item.status || 'New'} · {String(item.followUpDate || today)}</Text>{contactButtons(item.phone, item.name || '', 'please let us know if you would like to proceed with your enquiry')}</View>)}</View>
    <View style={card}><Text style={text}>{t('Add a work item')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{kinds.map((value) => <FilterPill key={value} label={value} active={value === kind} onPress={() => setKind(value)} />)}</View>
      <TextField label="Task title" value={title} onChangeText={setTitle} maxLength={160} /><TextField label="Due date (YYYY-MM-DD)" value={date} onChangeText={setDate} /><TextField label="Room / seat / area" value={allocation} onChangeText={setAllocation} maxLength={80} />
      <Text style={text}>{t('Customer (optional)')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><FilterPill label="None" active={!customerId} onPress={() => { setCustomerId(''); setRequestId(''); }} />{tenants.data.filter((item) => !item.archived).map((item) => <FilterPill key={item.id} label={item.fullName || item.name || item.id} active={item.id === customerId} onPress={() => { setCustomerId(item.id); setAllocation(item.room || ''); setRequestId(''); }} />)}</View>
      <Text style={text}>{t('Linked help request (optional)')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><FilterPill label="None" active={!requestId} onPress={() => setRequestId('')} />{requests.data.filter((item) => item.customerId === customerId && item.status !== 'resolved').map((item) => <FilterPill key={item.id} label={String(item.message || '').slice(0, 60)} active={item.id === requestId} onPress={() => { setRequestId(item.id); setTitle(String(item.message || '').slice(0, 160)); }} />)}</View>
      <Text style={text}>{t('Assign to')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><FilterPill label="Unassigned" active={!assignedTo} onPress={() => { setAssignedTo(''); setAssignedName(''); }} /><FilterPill label="Me" active={assignedTo === auth.currentUser?.uid} onPress={() => { setAssignedTo(auth.currentUser?.uid || ''); setAssignedName('Me'); }} />{people.data.filter((item) => ['admin', 'staff'].includes(String(item.role)) && ['active', 'invited'].includes(String(item.accessStatus))).map((item) => <FilterPill key={item.id} label={String(item.name || item.email)} active={assignedTo === item.id} onPress={() => { setAssignedTo(item.id); setAssignedName(String(item.name || item.email)); }} />)}</View>
      <PrimaryButton label="Save work item" loading={busy || loading} onPress={createWork} /><PrimaryButton label="Create daily room cleaning checklist" loading={busy || loading} onPress={cleaningChecklist} />
    </View>
    <View style={card}><Text style={text}>{t('Work checklist')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[['All', ''], ['Open', 'open'], ['In progress', 'in_progress'], ['Done', 'done']].map(([label, value]) => <FilterPill key={label} label={label} active={filter === value} onPress={() => setFilter(value)} />)}</View><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><FilterPill label="All" active={!kindFilter} onPress={() => setKindFilter('')} />{kinds.map((value) => <FilterPill key={value} label={value} active={kindFilter === value} onPress={() => setKindFilter(value)} />)}</View>
      {work.data.filter((item) => (!filter || item.status === filter) && (!kindFilter || item.kind === kindFilter)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((item) => <View key={item.id} style={{ gap: 8, marginTop: 12 }}><Text style={{ color: item.status !== 'done' && item.dueDate < today ? colors.danger : colors.text }}>{item.title} · {item.kind} · {item.dueDate} · {t(statusLabels[item.status])}</Text><Text style={text}>{item.allocation} · {item.customerName} · {item.assignedName || t('Unassigned')}</Text>{item.supportRequestId ? <Text style={text}>{t('Linked help request')}: {requests.data.find((request) => request.id === item.supportRequestId)?.message}</Text> : null}
        {item.status === 'done' ? <Text style={text}>{item.outcome}</Text> : <><TextField label="Contact / completion outcome" value={outcomes[item.id] ?? item.outcome} onChangeText={(value) => setOutcomes((current) => ({ ...current, [item.id]: value }))} maxLength={2000} multiline />{item.status === 'open' ? <PrimaryButton label="Start" loading={busy} onPress={() => updateWork(item, 'in_progress')} /> : null}<PrimaryButton label="Mark done" loading={busy} onPress={() => updateWork(item, 'done')} /><TextField label="Next follow-up date (YYYY-MM-DD)" value={reschedule[item.id] || item.dueDate} onChangeText={(value) => setReschedule((current) => ({ ...current, [item.id]: value }))} /><PrimaryButton label="Save next follow-up" loading={busy} onPress={() => updateWork(item, item.status, reschedule[item.id] || item.dueDate)} /></>}
      </View>)}
    </View>
  </View>;
}
