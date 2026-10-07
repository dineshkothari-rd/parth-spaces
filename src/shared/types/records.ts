export type FirestoreRecord = {
  id: string;
  [key: string]: unknown;
};

export type TenantRecord = FirestoreRecord & {
  archived?: boolean;
  archivedAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  archivedBy?: string;
  additionalGuests?: string[];
  businessType?: string;
  documentId?: string;
  documentType?: string;
  fullName?: string;
  email?: string;
  accessStatus?: 'active' | 'invited' | 'revoked' | 'suspended';
  idProof?: string | null;
  idProofName?: string | null;
  idProofSize?: number;
  idProofType?: string | null;
  idProofBack?: string | null;
  idProofBackName?: string | null;
  idProofBackSize?: number;
  customerPhoto?: string | null;
  customerPhotoName?: string | null;
  customerPhotoSize?: number;
  moveInTime?: string;
  moveInDate?: string;
  moveOutDate?: string;
  moveOutTime?: string;
  name?: string;
  phone?: string;
  rent?: number | string;
  room?: string;
  roomType?: string;
  services?: string[];
  status?: string;
  checkedOutAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  checkedInAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  checkInMeterReading?: number | string;
  checkInMeterReadingId?: string;
  checkOutMeterReading?: number | string;
  checkOutMeterReadingId?: string;
  checkInDate?: string;
  checkOutDate?: string;
  checkoutDate?: string;
  checkoutTime?: string;
  endDate?: string;
  tenantName?: string;
  userId?: string;
};

export type PaymentRecord = FirestoreRecord & {
  amount?: number | string;
  amountPaid?: number | string;
  paymentMode?: string;
  reference?: string;
  collectedBy?: string;
  balance?: number | string;
  month?: string;
  name?: string;
  paid?: number | string;
  paidOn?: string;
  status?: string;
  tenantId?: string;
  tenantName?: string;
  tenantRoom?: string;
  totalRent?: number | string;
  userId?: string;
  createdAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  updatedAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  date?: string;
  note?: string;
  businessType?: string;
  voidedAt?: { seconds?: number; toDate?: () => Date };
  voidedBy?: string;
};

export type InvoiceRecord = FirestoreRecord & {
  extraCharge?: number;
  discount?: number;
  dueDate?: string;
  note?: string;
  baseAmount: number;
  businessType: string;
  issuedAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  issuedBy: string;
  meterAmount: number;
  month: string;
  status: 'Issued';
  tenantId: string;
  tenantName: string;
  tenantRoom: string;
  total: number;
};

export type AuditEventRecord = FirestoreRecord & {
  action?: string;
  actorUid?: string;
  createdAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  entityId?: string;
  entityType?: string;
  month?: string;
};

export type SettlementRecord = FirestoreRecord & {
  depositApplied: number;
  depositHeld: number;
  discount: number;
  extraCharge: number;
  finalBalance: number;
  finalizedAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  finalizedBy: string;
  grossDue: number;
  ledgerBalance: number;
  month: string;
  paidAtSettlement: number;
  paymentReceived: number;
  refundDue: number;
  refundStatus: 'Due' | 'None' | 'Paid';
  refundedAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  refundedBy?: string;
  status: 'Final';
  tenantId: string;
  tenantName: string;
};

export type ExpenseRecord = FirestoreRecord & {
  amount?: number | string;
  category?: string;
  cost?: number | string;
  date?: string;
  description?: string;
  expenseDate?: string;
  name?: string;
  title?: string;
  total?: number | string;
  status?: string;
  voidedAt?: { seconds?: number; toDate?: () => Date };
  voidedBy?: string;
};

export type EnquiryRecord = FirestoreRecord & {
  businessType?: string;
  createdAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  email?: string;
  message?: string;
  name?: string;
  phone?: string;
  roomType?: string;
  status?: string;
};

export type NoticeRecord = FirestoreRecord & {
  audience?: 'all' | 'customer' | 'staff';
  createdAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  message?: string;
  tenantId?: string;
  tenantName?: string;
  title?: string;
  type?: string;
};

export type SupportRequestRecord = FirestoreRecord & {
  createdAt?: { seconds?: number; toDate?: () => Date };
  createdBy?: string;
  customerId?: string;
  customerName?: string;
  message?: string;
  response?: string;
  status?: 'in_progress' | 'open' | 'resolved';
  type?: 'issue' | 'profile_correction';
  updatedAt?: { seconds?: number; toDate?: () => Date };
  updatedBy?: string;
};

export type MeterReadingRecord = FirestoreRecord & {
  billAmount?: number | string;
  currentReading?: number | string;
  month?: string;
  note?: string;
  previousReading?: number | string;
  ratePerUnit?: number | string;
  tenantId?: string;
  tenantName?: string;
  tenantRoom?: string;
  unitsConsumed?: number | string;
  readingType?: 'check-in' | 'check-out' | 'manual';
  photo?: string;
  photoSize?: number;
  ocrText?: string;
  readingSource?: string;
  createdAt?: {
    seconds?: number;
    toDate?: () => Date;
  };
  status?: string;
  voidedAt?: { seconds?: number; toDate?: () => Date };
  voidedBy?: string;
};

export type DueRecord = {
  extraCharge?: number;
  discount?: number;
  dueDate?: string;
  note?: string;
  baseAmount: number;
  balance: number;
  businessType: string;
  id: string;
  meterAmount: number;
  month: string;
  paid: number;
  phone: string;
  rent: number;
  status: 'Paid' | 'Partial' | 'Pending';
  tenantId: string;
  tenantName: string;
  tenantRoom: string;
};

export interface DepositAccount extends FirestoreRecord {
  tenantId: string;
  held: number;
  eventId: string;
}
export interface DepositEvent extends FirestoreRecord {
  tenantId: string;
  tenantName: string;
  kind: 'collection' | 'deduction' | 'refund' | 'application';
  amount: number;
  before: number;
  after: number;
  paymentMode: string;
  reference: string;
  note: string;
  createdAt?: { seconds?: number };
  createdBy: string;
}
export interface MembershipPlan extends FirestoreRecord {
  name: string;
  months: number;
  monthlyFee: number;
  active: boolean;
}
export interface MembershipRecord extends FirestoreRecord {
  tenantId: string;
  tenantName: string;
  planId: string;
  planName: string;
  monthlyFee: number;
  start: string;
  end: string;
  seat: string;
  invoiceMonths: string[];
}
export interface AgreementRecord extends FirestoreRecord {
  tenantId: string;
  tenantName: string;
  businessName: string;
  address: string;
  room: string;
  fee: number;
  start: string;
  end: string;
  terms: string;
  status: 'Draft' | 'Accepted';
  signedPhoto?: string;
  acceptedAt?: { seconds?: number };
  acceptedBy?: string;
  acceptanceName?: string;
  createdAt?: { seconds?: number };
}
