export type NotificationPrefs = {
  newJob: boolean;
  jobReminder: boolean;
  payProcessed: boolean;
  ratingReceived: boolean;
  documentToSign: boolean;
  trainingAssigned: boolean;
  multiplierChange: boolean;
  lowInventory: boolean;
  providerLowStock: boolean;
  cleanerPayment: boolean;
  immediatePayout: boolean;
  latePayment: boolean;
  clientComplaint: boolean;
  ratingDecrease: boolean;
  overdueCommercial: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newJob: true,
  jobReminder: true,
  payProcessed: true,
  ratingReceived: true,
  documentToSign: true,
  trainingAssigned: true,
  multiplierChange: true,
  lowInventory: true,
  providerLowStock: true,
  cleanerPayment: true,
  immediatePayout: true,
  latePayment: true,
  clientComplaint: true,
  ratingDecrease: true,
  overdueCommercial: true,
};
