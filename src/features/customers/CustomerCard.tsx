import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import type { TenantRecord } from '../../shared/types/records';
import { money } from '../../shared/utils/money';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { getBusinessType } from './businessTypes';
import { getCustomerName, getCustomerStatus, getCustomerStatusGroup, getCustomerStatusLabel, getCustomerSubtitle, maskDocumentId } from './customerUtils';

type CustomerCardProps = {
  accessChanging?: boolean;
  accessActionLabel?: string;
  customer: TenantRecord;
  deleting?: boolean;
  expanded: boolean;
  inviting?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  onInvite?: () => void;
  onCheckOut?: () => void;
  checkingOut?: boolean;
  onCheckIn?: () => void;
  checkingIn?: boolean;
  cancelling?: boolean;
  onCancel?: () => void;
  onAccessChange?: () => void;
  onToggle: () => void;
  onViewIdProof?: () => void;
};

export function CustomerCard({ accessActionLabel, accessChanging = false, customer, cancelling = false, checkingIn = false, checkingOut = false, deleting = false, expanded, inviting = false, onAccessChange, onCancel, onCheckIn, onCheckOut, onDelete, onEdit, onInvite, onToggle, onViewIdProof }: CustomerCardProps) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const businessType = getBusinessType(customer.businessType);
  const services = Array.isArray(customer.services) ? customer.services : [];
  const additionalGuests = Array.isArray(customer.additionalGuests) ? customer.additionalGuests.filter(Boolean) : [];
  const status = getCustomerStatus(customer);
  const statusGroup = getCustomerStatusGroup(customer);
  const usesRoomLifecycle = ['pg', 'hotel'].includes(String(customer.businessType || 'pg'));
  const requiresMeter = String(customer.businessType || 'pg') === 'pg';
  const canCheckIn = usesRoomLifecycle && status === 'booked';
  const canCheckOut = usesRoomLifecycle && ['checked in', 'occupied', 'active'].includes(status);
  const snapshotTitle = customer.businessType === 'library'
    ? 'Membership snapshot'
    : customer.businessType === 'hotel'
      ? 'Stay snapshot'
      : 'Tenant snapshot';

  function callCustomer() {
    if (!customer.phone) return;
    Linking.openURL(`tel:${customer.phone}`).catch(() => undefined);
  }

  return (
    <View style={[styles.card, expanded && styles.cardExpanded]}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          {customer.customerPhoto ? (
            <Image resizeMode="cover" source={{ uri: customer.customerPhoto }} style={styles.avatarPhoto} />
          ) : (
            <Text style={styles.avatarText}>{getCustomerName(customer).slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{getCustomerName(customer)}</Text>
          <Text style={styles.subtitle}>{getCustomerSubtitle(customer)}</Text>
        </View>
        <View style={[styles.statusPill, statusGroup === 'active' && styles.statusPillActive, statusGroup === 'completed' && styles.statusPillCompleted]}>
          <Text style={styles.statusText}>{t(getCustomerStatusLabel(customer))}</Text>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <Detail label={t(businessType.feeLabel)} styles={styles} value={money(customer.rent)} />
        <Detail action={callCustomer} label={t('Phone')} styles={styles} value={customer.phone || '-'} />
        <Detail label={t('Document ID')} styles={styles} value={maskDocumentId(customer.documentId)} />
        <Detail label={t(businessType.startDateLabel)} styles={styles} value={customer.moveInDate || '-'} />
        <Detail label={t(businessType.endDateLabel)} styles={styles} value={customer.moveOutDate || '-'} />
      </View>

      {services.length ? (
        <View style={styles.services}>
          {services.slice(0, 4).map((service) => (
            <Text key={service} style={styles.service}>{service}</Text>
          ))}
        </View>
      ) : null}

      {customer.businessType === 'hotel' && additionalGuests.length ? (
        <View style={styles.additionalGuestsBox}>
          <Text style={styles.additionalGuestsLabel}>{t('Additional hotel guests')}</Text>
          {additionalGuests.map((guest, index) => (
            <Text key={`${guest}-${index}`} style={styles.additionalGuestName}>{index + 2}. {guest}</Text>
          ))}
        </View>
      ) : null}

      {customer.idProof ? (
        <Pressable accessibilityRole="button" disabled={!onViewIdProof} onPress={onViewIdProof} style={styles.proofCard}>
          {String(customer.idProof).startsWith('data:image') ? (
            <Image resizeMode="cover" source={{ uri: customer.idProof }} style={styles.proofThumbnail} />
          ) : (
            <View style={styles.proofPlaceholder}>
              <Text style={styles.proofPlaceholderText}>ID</Text>
            </View>
          )}
          <View style={styles.proofCopy}>
            <Text style={styles.proofTitle}>{t('ID proof')}</Text>
            <Text style={styles.proofName} numberOfLines={1}>{customer.idProofName || t('Document image')}</Text>
            <Text style={styles.proofView}>{t('View full image')}</Text>
          </View>
        </Pressable>
      ) : null}

      {canCheckIn && onCheckIn ? (
        <Pressable accessibilityRole="button" disabled={checkingIn} onPress={onCheckIn} style={styles.lifecycleAction}>
          <Text style={styles.lifecycleActionText}>{t(checkingIn ? 'Checking in...' : requiresMeter ? 'Check in with meter photo' : 'Check in')}</Text>
        </Pressable>
      ) : null}
      {canCheckOut && onCheckOut ? (
        <Pressable accessibilityRole="button" disabled={checkingOut} onPress={onCheckOut} style={styles.lifecycleAction}>
          <Text style={styles.lifecycleActionText}>{t(checkingOut ? 'Checking out...' : requiresMeter ? 'Check out with meter photo' : 'Check out')}</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.toggleButton}>
        <Text style={styles.toggleButtonText}>{t(expanded ? 'Hide details' : 'View details')}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.expandedPanel}>
          <Text style={styles.expandedTitle}>{t(snapshotTitle)}</Text>
          <Text style={styles.expandedText}>
            {services.length ? `${services.join(', ')} ${t('included.')}` : t('No services added yet.')}
          </Text>
          {customer.userId ? (
            <Text style={styles.expandedText}>{t('App access')}: {t(`${String(customer.accessStatus || 'invited').charAt(0).toUpperCase()}${String(customer.accessStatus || 'invited').slice(1)}`)}</Text>
          ) : null}
          <View style={styles.expandedActions}>
            <Pressable accessibilityRole="button" disabled={!customer.phone} onPress={callCustomer} style={styles.expandedAction}>
              <Text style={styles.expandedActionText}>{t('Call')}</Text>
            </Pressable>
            {onEdit ? (
              <Pressable accessibilityRole="button" onPress={onEdit} style={styles.expandedAction}>
                <Text style={styles.expandedActionText}>{t('Edit')}</Text>
              </Pressable>
            ) : null}
            {onInvite ? (
              <Pressable accessibilityRole="button" disabled={inviting} onPress={onInvite} style={[styles.expandedAction, inviting && styles.disabledAction]}>
                <Text style={styles.expandedActionText}>{t(inviting ? 'Sending access...' : customer.userId ? 'Resend access email' : 'Send access email')}</Text>
              </Pressable>
            ) : null}
            {onAccessChange && accessActionLabel ? (
              <Pressable accessibilityRole="button" disabled={accessChanging} onPress={onAccessChange} style={[styles.expandedAction, accessChanging && styles.disabledAction]}>
                <Text style={styles.expandedActionText}>{t(accessChanging ? customer.accessStatus === 'suspended' ? 'Restoring access...' : 'Suspending access...' : accessActionLabel)}</Text>
              </Pressable>
            ) : null}
          </View>
          {statusGroup === 'reserved' && onCancel ? (
            <Pressable accessibilityRole="button" disabled={cancelling} onPress={onCancel} style={[styles.deleteAction, cancelling && styles.disabledAction]}>
              <Text style={styles.deleteActionText}>{t(cancelling ? 'Cancelling...' : 'Cancel reservation')}</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable accessibilityRole="button" disabled={deleting} onPress={onDelete} style={[styles.deleteAction, deleting && styles.disabledAction]}>
              <Text style={styles.deleteActionText}>{t(deleting ? 'Archiving...' : 'Archive customer')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Detail({
  action,
  label,
  styles,
  value,
}: {
  action?: () => void;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  const content = (
    <>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, action && styles.linkValue]} numberOfLines={1}>{value}</Text>
    </>
  );

  if (action) {
    return (
      <Pressable accessibilityRole="button" onPress={action} style={styles.detailBox}>
        {content}
      </Pressable>
    );
  }

  return <View style={styles.detailBox}>{content}</View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardExpanded: {
    borderColor: colors.brand,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  nameBlock: {
    flex: 1,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.copperSoft,
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42,
  },
  avatarText: {
    color: colors.link,
    fontSize: 18,
    fontWeight: typography.weight.black,
  },
  avatarPhoto: { height: '100%', width: '100%' },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: typography.weight.black,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    marginTop: 4,
  },
  statusPill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  statusPillActive: {
    backgroundColor: colors.successSoft,
  },
  statusPillCompleted: {
    backgroundColor: colors.surfaceMuted,
  },
  statusText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weight.black,
    textTransform: 'uppercase',
  },
  lifecycleAction: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  lifecycleActionText: {
    color: colors.onBrand,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detailBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 66,
    padding: spacing.md,
    width: '48%',
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weight.black,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
    marginTop: 5,
  },
  linkValue: {
    color: colors.link,
  },
  services: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  additionalGuestsBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  additionalGuestsLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weight.black,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  additionalGuestName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    marginTop: 3,
  },
  service: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    color: colors.link,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  proofCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  proofThumbnail: {
    borderRadius: radius.sm,
    height: 72,
    width: 88,
  },
  proofPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    height: 72,
    justifyContent: 'center',
    width: 88,
  },
  proofPlaceholderText: {
    color: colors.onBrand,
    fontSize: 18,
    fontWeight: typography.weight.black,
  },
  proofCopy: {
    flex: 1,
  },
  proofTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  proofName: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  proofView: {
    color: colors.link,
    fontSize: 12,
    fontWeight: typography.weight.black,
    marginTop: spacing.sm,
  },
  toggleButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  toggleButtonText: {
    color: colors.onBrand,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  expandedPanel: {
    backgroundColor: colors.skySoft,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  expandedTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  expandedText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  expandedActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  expandedAction: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  expandedActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  deleteAction: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    marginTop: spacing.md,
    minHeight: 42,
    justifyContent: 'center',
  },
  deleteActionText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  disabledAction: {
    opacity: 0.45,
  },
  });
}
