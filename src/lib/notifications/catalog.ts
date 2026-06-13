// Master catalog of every notification the system supports.
// Mirrors the TeamCleano Notification Catalog spec (Updated 2026-05-26).
//
// Each entry seeds a NotificationSetting row. Re-seeding is idempotent
// per (recipient, key, channel): existing rows keep their `enabled` value
// so admin toggles survive future deploys.

export type Recipient = "ADMIN" | "CUSTOMER" | "PROVIDER";
export type Channel = "EMAIL" | "SMS" | "APP_PUSH";

export interface CatalogEntry {
  recipient: Recipient;
  category: string;
  key: string;
  label: string;
  trigger: string;
  channels: Partial<Record<Channel, boolean>>;
  isProposed?: boolean;
}

export const NOTIFICATION_CATALOG: CatalogEntry[] = [
  // ─── ADMIN ────────────────────────────────────────────────────────
  // Account
  {
    recipient: "ADMIN",
    category: "Account",
    key: "admin.account.deactivation_request",
    label: "Account deactivation request",
    trigger: "Customer requests to deactivate their account.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  // General
  {
    recipient: "ADMIN",
    category: "General",
    key: "admin.general.gcal_failed_sync",
    label: "Google Calendar failed sync",
    trigger: "Booking sync to admin Google Calendar fails.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "General",
    key: "admin.general.gcal_failed_sync_provider",
    label: "Google Calendar failed sync for provider",
    trigger: "Booking sync fails for a provider Google Calendar.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "General",
    key: "admin.general.gsheets_failed_sync",
    label: "Google Sheets failed sync",
    trigger: "Event sync to Google Sheets fails.",
    channels: { EMAIL: true, SMS: false },
  },
  // New & modified booking
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.new",
    label: "New booking",
    trigger: "A new booking is created.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.new_via_referral",
    label: "New booking via referral",
    trigger: "A new booking is created through a referral.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: false },
  },
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.modified",
    label: "Booking modified",
    trigger: "A booking is modified.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: false },
  },
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.modified_after_5pm",
    label: "Booking modified after 5 pm",
    trigger: "A booking is modified after 5 pm the day before service.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.accepted",
    label: "Booking accepted",
    trigger: "A booking is accepted.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "New & modified booking",
    key: "admin.booking.declined",
    label: "Booking declined",
    trigger: "A booking is declined.",
    channels: { EMAIL: false, SMS: false },
  },
  // Canceled & postponed booking
  {
    recipient: "ADMIN",
    category: "Canceled & postponed booking",
    key: "admin.cancel.booking_canceled",
    label: "Booking canceled",
    trigger: "A booking is canceled.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Canceled & postponed booking",
    key: "admin.cancel.booking_canceled_after_5pm",
    label: "Booking canceled after 5 pm",
    trigger: "A booking is canceled after 5 pm the day before service.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Canceled & postponed booking",
    key: "admin.cancel.booking_cancellation_request",
    label: "Booking cancellation request",
    trigger: "Customer requests to cancel their booking.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Canceled & postponed booking",
    key: "admin.cancel.booking_canceled_card_hold_failure",
    label: "Booking canceled due to card hold failure",
    trigger: "Booking is canceled because the card hold failed.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Canceled & postponed booking",
    key: "admin.cancel.postpone_booking",
    label: "Postpone booking",
    trigger: "Customer postpones an upcoming booking.",
    channels: { EMAIL: true, SMS: false },
  },
  // Unassigned booking
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.new",
    label: "New booking in unassigned folder",
    trigger: "A new booking lands in the unassigned folder.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.moved",
    label: "Booking moved to unassigned folder",
    trigger: "A modified booking is moved to the unassigned folder.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.modified",
    label: "Booking modified in unassigned folder",
    trigger: "A booking in the unassigned folder is modified.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.grabbed",
    label: "Someone grabbed a job from unassigned folder",
    trigger: "A provider accepts a job from the unassigned folder.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: false },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.starts_12h",
    label: "Unassigned booking starting in < 12 hours",
    trigger: "Unassigned booking starts in under 12 hours and has no provider.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.starts_4h",
    label: "Unassigned booking starting in < 4 hours",
    trigger: "Unassigned booking starts in under 4 hours and has no provider.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Unassigned booking",
    key: "admin.unassigned.starts_1h",
    label: "Unassigned booking starting in < 1 hour",
    trigger: "Unassigned booking starts in under 1 hour and has no provider.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  // Reminders
  {
    recipient: "ADMIN",
    category: "Reminders",
    key: "admin.reminders.job",
    label: "Job reminders",
    trigger: "Reminder sent 24 hours before booking starts.",
    channels: { EMAIL: false, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Reminders",
    key: "admin.reminders.admin_set",
    label: "Email reminder to admin",
    trigger: "Admin sets a job reminder while creating or editing a booking.",
    channels: { EMAIL: true },
  },
  {
    recipient: "ADMIN",
    category: "Reminders",
    key: "admin.reminders.cash_check",
    label: "Bookings with cash/check reminder",
    trigger: "Upcoming booking has cash/check payment option.",
    channels: { EMAIL: false, SMS: false },
  },
  // Booking fee charged
  {
    recipient: "ADMIN",
    category: "Booking fee charged",
    key: "admin.fee.cancellation_cash",
    label: "Cancellation fee charged with cash/check",
    trigger: "Cancellation fee is successfully charged using cash/check.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Booking fee charged",
    key: "admin.fee.canceled_after_1st_cash",
    label: "Canceled after 1st appointment fee charged with cash/check",
    trigger: "Customer canceled after first appointment and fee is charged using cash/check.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Booking fee charged",
    key: "admin.fee.tip_received",
    label: "Tip received (Post-Booking)",
    trigger: "A tip is charged post-booking.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Booking fee charged",
    key: "admin.fee.extra_charge_cash",
    label: "Extra charge charged with cash/check",
    trigger: "An extra charge is charged using cash/check.",
    channels: { EMAIL: true, SMS: false },
  },
  // Payments/cards
  {
    recipient: "ADMIN",
    category: "Payments / cards",
    key: "admin.card.declined",
    label: "Declined card",
    trigger: "Debit/credit card is declined.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Payments / cards",
    key: "admin.card.declined_on_hold",
    label: "Card declined on hold",
    trigger: "Card declines while trying to place a hold.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payments / cards",
    key: "admin.card.modified_hold_failed",
    label: "Booking modified but card hold failed",
    trigger: "Booking was modified but card hold failed.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payments / cards",
    key: "admin.card.new_card_added",
    label: "New card added by customer",
    trigger: "Customer adds a new card.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payments / cards",
    key: "admin.card.hold_released",
    label: "Card hold amount released",
    trigger: "Card hold is released by the payment processor.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  // Rating & review
  {
    recipient: "ADMIN",
    category: "Rating & review",
    key: "admin.rating.new",
    label: "New review",
    trigger: "Provider gets rated for a job.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Rating & review",
    key: "admin.rating.poor",
    label: "Poor rating",
    trigger: "Provider receives a rating of 3 out of 5 or lower.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Rating & review",
    key: "admin.rating.poor_twice_week",
    label: "Poor rating twice a week",
    trigger: "Provider receives 3/5 or lower twice in the same week.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  {
    recipient: "ADMIN",
    category: "Rating & review",
    key: "admin.rating.overall_dropped",
    label: "Provider overall rating dropped",
    trigger: "Provider overall rating drops below 4/5.",
    channels: { EMAIL: true, SMS: false, APP_PUSH: true },
  },
  // Gift card & referral
  {
    recipient: "ADMIN",
    category: "Gift card & referral",
    key: "admin.giftcard.new_purchased",
    label: "New gift card purchased",
    trigger: "A new gift card is purchased.",
    channels: { EMAIL: false, SMS: false },
  },
  // Payment processor
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.pending",
    label: "Payment processor account pending",
    trigger: "Provider payment processor account is created but restricted due to missing information.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.verification_failed",
    label: "Payment processor account verification failed",
    trigger: "Provider payment processor verification fails.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.connected",
    label: "Payment processor account connected",
    trigger: "Provider payment processor connects successfully.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.onboarding_completed",
    label: "Payment processor account onboarding completed",
    trigger: "Provider completes payment processor onboarding.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.restricted",
    label: "Payment processor account restricted",
    trigger: "Provider payment processor account becomes restricted.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Payment processor",
    key: "admin.processor.rejected",
    label: "Payment processor account rejected",
    trigger: "Provider payment processor account is rejected.",
    channels: { EMAIL: true },
  },
  // Schedule & settings
  {
    recipient: "ADMIN",
    category: "Schedule & settings",
    key: "admin.schedule.settings_modification_request",
    label: "Settings modification request",
    trigger: "Provider requests a change to settings.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Schedule & settings",
    key: "admin.schedule.schedule_modification_request",
    label: "Schedule modification request",
    trigger: "Provider requests a schedule change.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Schedule & settings",
    key: "admin.schedule.schedule_updated",
    label: "Schedule updated",
    trigger: "Provider updates their schedule.",
    channels: { EMAIL: true },
  },
  {
    recipient: "ADMIN",
    category: "Schedule & settings",
    key: "admin.schedule.settings_updated",
    label: "Settings updated",
    trigger: "Provider updates their settings.",
    channels: { EMAIL: true },
  },
  // Clock in/clock out
  {
    recipient: "ADMIN",
    category: "Clock in / clock out",
    key: "admin.clock.on_the_way",
    label: "Provider on the way",
    trigger: "Provider clicks On the Way.",
    channels: { EMAIL: false, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Clock in / clock out",
    key: "admin.clock.not_on_the_way",
    label: "Provider not on the way",
    trigger: "Provider has not clicked On the Way.",
    channels: { EMAIL: false, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Clock in / clock out",
    key: "admin.clock.not_clocked_in",
    label: "Booking not clocked in",
    trigger: "Provider has not clocked in.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Clock in / clock out",
    key: "admin.clock.clocked_in",
    label: "Booking clocked in",
    trigger: "Provider clocks in.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Clock in / clock out",
    key: "admin.clock.clocked_out",
    label: "Booking clocked out",
    trigger: "Provider clocks out.",
    channels: { EMAIL: false, SMS: false },
  },
  // Booking reschedule fee
  {
    recipient: "ADMIN",
    category: "Booking reschedule fee charged & failed",
    key: "admin.reschedule.fee_charged",
    label: "Booking reschedule fee charged",
    trigger: "Booking reschedule fee is charged.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Booking reschedule fee charged & failed",
    key: "admin.reschedule.card_declined",
    label: "Card declined during reschedule fee charged",
    trigger: "Card declines while charging the reschedule fee.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Booking reschedule fee charged & failed",
    key: "admin.reschedule.fee_declined",
    label: "Booking reschedule fee declined",
    trigger: "Booking reschedule fee is declined.",
    channels: { EMAIL: true },
  },
  // Checklist
  {
    recipient: "ADMIN",
    category: "Checklist",
    key: "admin.checklist.completed",
    label: "Checklist completed",
    trigger: "A checklist is completed.",
    channels: { EMAIL: true, SMS: false },
  },
  // Invoice
  {
    recipient: "ADMIN",
    category: "Invoice",
    key: "admin.invoice.partial_charge",
    label: "Invoice partial charge",
    trigger: "Invoice is partially charged or paid.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Invoice",
    key: "admin.invoice.charge",
    label: "Invoice charge",
    trigger: "Invoice is fully charged or paid.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Invoice",
    key: "admin.invoice.card_declined",
    label: "Invoice card declined",
    trigger: "Card declines while charging an invoice.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Invoice",
    key: "admin.invoice.skip",
    label: "Skip invoice",
    trigger: "Invoice is skipped because no valid booking/invoice generation condition is found.",
    channels: { EMAIL: false },
  },
  {
    recipient: "ADMIN",
    category: "Invoice",
    key: "admin.invoice.end_recurring",
    label: "End recurring invoice schedule",
    trigger: "Recurring invoice schedule ends due to no bookings or cancellations.",
    channels: { EMAIL: false },
  },
  // Signup
  {
    recipient: "ADMIN",
    category: "Signup",
    key: "admin.signup.new_provider",
    label: "New service provider signed up",
    trigger: "A new provider successfully signs up.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Signup",
    key: "admin.signup.upgrade_plan",
    label: "Upgrade plan to approve new service provider",
    trigger: "Provider signs up but plan provider limit has been reached.",
    channels: { EMAIL: true, SMS: false },
  },
  {
    recipient: "ADMIN",
    category: "Signup",
    key: "admin.signup.review_request",
    label: "Review provider sign up request",
    trigger: "New provider signs up and needs approval/rejection.",
    channels: { EMAIL: true, SMS: false },
  },
  // Chat (admin)
  {
    recipient: "ADMIN",
    category: "Chat",
    key: "admin.chat.new_message",
    label: "New message",
    trigger: "A new chat message is received.",
    channels: { APP_PUSH: true },
  },

  // ─── CUSTOMER ─────────────────────────────────────────────────────
  // Account
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.new", label: "New account", trigger: "Customer creates their new account.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.setup_password", label: "Set up new password", trigger: "Customer needs to set up a password.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.reset_password", label: "Reset password", trigger: "Customer needs to reset their password.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.password_changed", label: "Password changed", trigger: "Customer password is changed.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.profile_changed", label: "Profile info changed", trigger: "Customer profile information changes.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.activated", label: "Customer activated", trigger: "Customer account is activated.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.deactivated", label: "Customer deactivated", trigger: "Customer account is deactivated.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Account", key: "cust.account.add_card", label: "Add card", trigger: "Customer is asked to add a card to their profile.", channels: { EMAIL: true } },
  // New & modified booking
  { recipient: "CUSTOMER", category: "New & modified booking", key: "cust.booking.receipt_ot", label: "Receipt email OT", trigger: "Customer books a one-time booking using card or cash/check.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "New & modified booking", key: "cust.booking.receipt_rec", label: "Receipt email REC", trigger: "Customer books a recurring booking using card or cash/check.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "New & modified booking", key: "cust.booking.confirmed", label: "Booking confirmed", trigger: "Booking is confirmed by pairing a provider with that booking.", channels: { EMAIL: true, SMS: true } },
  { recipient: "CUSTOMER", category: "New & modified booking", key: "cust.booking.modified", label: "Booking modified", trigger: "Customer booking is modified.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "New & modified booking", key: "cust.booking.on_the_way", label: "Cleaner on the way", trigger: "Cleaner ETA drops below the configured threshold (15 min by default).", channels: { EMAIL: false, SMS: true, APP_PUSH: true } },
  // Canceled booking
  { recipient: "CUSTOMER", category: "Canceled booking", key: "cust.cancel.booking_cancellation", label: "Booking cancellation", trigger: "Customer booking is canceled.", channels: { EMAIL: true, SMS: true } },
  { recipient: "CUSTOMER", category: "Canceled booking", key: "cust.cancel.card_hold_failure", label: "Booking canceled due to card hold failure", trigger: "Booking canceled due to debit/credit card hold failure.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Canceled booking", key: "cust.cancel.never_found_provider", label: "Never found a provider", trigger: "A provider was not found for the customer booking.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Canceled booking", key: "cust.cancel.fee_authentication", label: "Cancellation fee authentication", trigger: "Customer must authenticate card for cancellation fee.", channels: { EMAIL: true } },
  // Reminders
  { recipient: "CUSTOMER", category: "Reminders", key: "cust.reminders.booking_reminder", label: "Booking reminder", trigger: "Customer reminded ~24h before service.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Reminders", key: "cust.reminders.booking_reminder_2", label: "Booking reminder 2", trigger: "Customer reminded ~48h before service.", channels: { EMAIL: true, SMS: true } },
  // Completed booking
  { recipient: "CUSTOMER", category: "Completed booking", key: "cust.completed.leave_tip", label: "Leave tip", trigger: "Customer is asked to leave a tip.", channels: { EMAIL: false } },
  // Booking fee charged & refund
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.booking_charged", label: "Booking charged", trigger: "Booking is successfully charged.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.service_receipt", label: "Service receipt", trigger: "Service receipt is sent to customer.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.fees_charged", label: "Fees charged", trigger: "Customer is charged a fee such as tip, cancellation, or extra.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.bookings_prepaid", label: "Bookings pre-paid", trigger: "Customer is charged for pre-payment of booking(s).", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.refund_given", label: "Refund given", trigger: "Customer receives a refund.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.card_charge_auth", label: "Card charge authentication", trigger: "Customer must authenticate card for a booking charge.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.precharge_auth", label: "Pre-charge authentication", trigger: "Customer must authenticate card for pre-paid booking charges.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.bulk_charge", label: "Bulk bookings charge", trigger: "A bulk charge is performed on customer bookings.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.bulk_charge_auth", label: "Bulk bookings charge authentication", trigger: "Customer must authenticate card for a bulk booking charge.", channels: { EMAIL: true } },
  // Card declined
  { recipient: "CUSTOMER", category: "Card declined", key: "cust.card.declined", label: "Card declined", trigger: "Customer card declines.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Card declined", key: "cust.card.declined_on_hold", label: "Card declined on hold", trigger: "Customer card declines during card hold process.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Card declined", key: "cust.card.modified_hold_failed", label: "Booking modified but card hold failed", trigger: "Booking was modified but card hold failed.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Card declined", key: "cust.card.hold_auth", label: "Card hold authentication", trigger: "Customer must authenticate card for card hold/pre-authorization.", channels: { EMAIL: true } },
  // Rating & review
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.rate_us", label: "Rate us", trigger: "Customer is asked to rate completed service.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.happy_ot_v1", label: "50% off your service (happy rating OT v1)", trigger: "Happy 4/5+ rating; offers recurring-service discount.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.happy_ot_v2", label: "Happy rating (OT v2)", trigger: "Happy 4/5+ rating, thank-you.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.happy_rec", label: "Happy rating (REC)", trigger: "Recurring customer leaves happy 4/5+ rating.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.average", label: "Average rating", trigger: "Customer leaves average 3/5 rating.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Rating & review", key: "cust.rating.poor", label: "Poor rating", trigger: "Customer leaves a 1-star rating; ops follow-up promised.", channels: { EMAIL: true } },
  // Gift card & referral
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.receipt", label: "Gift card receipt", trigger: "Customer purchases a gift card.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.new", label: "New gift card", trigger: "Customer receives a new gift card.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.refund", label: "Gift card refund given", trigger: "Customer receives a refund for a gift card.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.value_updated", label: "Gift card value updated", trigger: "Gift card value is updated or partially refunded.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.expired", label: "Gift card expired", trigger: "Gift card has no remaining value or has expired.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.ref.invitation", label: "Referral invitation", trigger: "Customer receives referral credits/invitation.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.ref.accepted", label: "Referral accepted", trigger: "Someone books using customer referral link.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.ref.earned_credits", label: "Earned referral credits", trigger: "Customer earns referral credits.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift card & referral", key: "cust.gift.auth", label: "Gift card authentication", trigger: "Customer must authenticate card to finalize gift card purchase.", channels: { EMAIL: true } },
  // Quote
  { recipient: "CUSTOMER", category: "Quote", key: "cust.quote.send", label: "Send quote", trigger: "Customer is sent a quote for a booking.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Quote", key: "cust.quote.reminder", label: "Quote reminder", trigger: "Customer is reminded about a quote.", channels: { EMAIL: false } },
  // Checklist
  { recipient: "CUSTOMER", category: "Checklist", key: "cust.checklist.view", label: "View checklist", trigger: "Checklist is completed and sent to customer.", channels: { EMAIL: false } },
  { recipient: "CUSTOMER", category: "Checklist", key: "cust.checklist.custom_msg", label: "Custom message email", trigger: "Custom checklist message is sent to customer.", channels: { EMAIL: false } },
  // Separate charge
  { recipient: "CUSTOMER", category: "Separate charge", key: "cust.separate.charge", label: "Separate charge", trigger: "Separate charge is processed.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Separate charge", key: "cust.separate.auth", label: "Separate charge authentication", trigger: "Customer must authenticate card for separate charge.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Separate charge", key: "cust.separate.refund", label: "Separate charge refund", trigger: "Separate charge is refunded.", channels: { EMAIL: true } },
  // Invoice
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.new", label: "New invoice", trigger: "New invoice is generated.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.update", label: "Update invoice", trigger: "Invoice is updated.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.resend", label: "Resend invoice", trigger: "Invoice is resent.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.partial_charge", label: "Invoice partial charge", trigger: "Invoice is partially paid.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.charge", label: "Invoice charge", trigger: "Invoice is fully paid.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.card_declined", label: "Invoice card declined", trigger: "Invoice card charge is declined.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.custom_refund", label: "Custom invoice refund", trigger: "Custom invoice is refunded.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.charge_auth", label: "Invoice charge authentication", trigger: "Customer must authenticate card for invoice charge.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.due_today", label: "Invoice due today reminder", trigger: "Invoice is due today.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.overdue", label: "Invoice overdue reminder", trigger: "Invoice is overdue.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.upcoming_payment", label: "Upcoming payment for invoice reminder", trigger: "Invoice payment is due soon.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Invoice", key: "cust.invoice.contract_otp", label: "Invoice contract OTP", trigger: "OTP is sent for invoice contract.", channels: { EMAIL: true } },

  // ─── PROVIDER ─────────────────────────────────────────────────────
  // Account
  { recipient: "PROVIDER", category: "Account", key: "prov.account.new", label: "New account", trigger: "Provider account is created.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.how_it_works", label: "How it works", trigger: "Provider onboarding email.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.reset_password", label: "Reset password", trigger: "Provider resets password.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.password_changed", label: "Password changed", trigger: "Provider password is changed.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.activated", label: "Account activated", trigger: "Provider account is activated.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.deactivated", label: "Account deactivated", trigger: "Provider account is deactivated.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.email_verification", label: "Provider sign up email verification", trigger: "Provider receives email verification upon sign up.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.signup_submitted", label: "Provider sign up request submitted", trigger: "Provider sign up request submitted.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Account", key: "prov.account.signup_rejected", label: "Provider sign up request rejected", trigger: "Provider sign up request rejected.", channels: { EMAIL: true } },
  // Drive
  { recipient: "PROVIDER", category: "Drive", key: "prov.drive.doc_uploaded", label: "Document uploaded to drive", trigger: "A document is uploaded to provider drive.", channels: { EMAIL: false } },
  // Unassigned booking
  { recipient: "PROVIDER", category: "Unassigned booking", key: "prov.unassigned.new", label: "New booking in unassigned folder", trigger: "New booking lands in the unassigned folder.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Unassigned booking", key: "prov.unassigned.invite", label: "New invite for a job in unassigned folder", trigger: "Provider is asked to pick up an extra job.", channels: { EMAIL: true, APP_PUSH: true } },
  // Reminders
  { recipient: "PROVIDER", category: "Reminders", key: "prov.reminders.unassigned", label: "Reminder for job in unassigned folder", trigger: "Provider reminded about a job in unassigned folder.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Reminders", key: "prov.reminders.one_day", label: "One day reminder", trigger: "Provider booking starts in 24 hours.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Reminders", key: "prov.reminders.one_hour", label: "One hour reminder", trigger: "Provider booking starts in 1 hour.", channels: { EMAIL: true, APP_PUSH: true } },
  // Rating & review
  { recipient: "PROVIDER", category: "Rating & review", key: "prov.rating.new_review", label: "New review", trigger: "Provider receives a new review from the customer.", channels: { EMAIL: true, APP_PUSH: true } },
  // Payments
  { recipient: "PROVIDER", category: "Payments", key: "prov.payments.received", label: "Payment received", trigger: "Provider receives a new payment.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payments", key: "prov.payments.new_tip", label: "New tip", trigger: "Provider receives a new tip from a customer.", channels: { EMAIL: false, APP_PUSH: true } },
  // Payment processor
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.pending", label: "Payment processor account pending", trigger: "Provider payment processor account is created with restricted status.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.verification_failed", label: "Payment processor account verification failed", trigger: "Provider payment processor verification failed.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.connected", label: "Payment processor account connected", trigger: "Provider payment processor connects successfully.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.onboarding_completed", label: "Payment processor account onboarding completed", trigger: "Provider completes payment processor onboarding.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.restricted", label: "Payment processor account restricted", trigger: "Provider payment processor account becomes restricted.", channels: { EMAIL: false, APP_PUSH: false } },
  { recipient: "PROVIDER", category: "Payment processor", key: "prov.processor.rejected", label: "Payment processor account rejected", trigger: "Provider payment processor account rejected.", channels: { EMAIL: false, APP_PUSH: false } },
  // Schedule & settings
  { recipient: "PROVIDER", category: "Schedule & settings", key: "prov.schedule.modification_response", label: "Schedule modification request response", trigger: "Admin responds to provider schedule modification request.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Schedule & settings", key: "prov.schedule.send_schedule", label: "Send schedule", trigger: "Provider receives their schedule for a certain date range.", channels: { EMAIL: true } },
  { recipient: "PROVIDER", category: "Schedule & settings", key: "prov.schedule.settings_approved", label: "Settings modification request approved", trigger: "Provider settings modification request is approved.", channels: { APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Schedule & settings", key: "prov.schedule.settings_declined", label: "Settings modification request declined", trigger: "Provider settings modification request is denied.", channels: { APP_PUSH: true } },
  // Checklist
  { recipient: "PROVIDER", category: "Checklist", key: "prov.checklist.custom_msg", label: "Custom message email", trigger: "Provider receives custom message from checklist progress page.", channels: { EMAIL: true } },
  // New & modified booking
  { recipient: "PROVIDER", category: "New & modified booking", key: "prov.booking.new", label: "New booking", trigger: "Provider has a new booking.", channels: { APP_PUSH: true } },
  { recipient: "PROVIDER", category: "New & modified booking", key: "prov.booking.modified", label: "Booking modified", trigger: "Provider scheduled booking is modified.", channels: { APP_PUSH: true } },
  { recipient: "PROVIDER", category: "New & modified booking", key: "prov.booking.modified_after_5pm", label: "Booking modified after 5 pm", trigger: "Provider scheduled booking is modified after 5 pm the day before service.", channels: { APP_PUSH: true } },
  // Canceled booking
  { recipient: "PROVIDER", category: "Canceled booking", key: "prov.cancel.booking_canceled", label: "Booking canceled", trigger: "Provider scheduled booking is canceled.", channels: { APP_PUSH: true, EMAIL: true } },
  { recipient: "PROVIDER", category: "Canceled booking", key: "prov.cancel.booking_canceled_after_5pm", label: "Booking canceled after 5 pm", trigger: "Provider scheduled booking is canceled after 5 pm the day before service.", channels: { APP_PUSH: true, EMAIL: true } },
  // Clock in/clock out
  { recipient: "PROVIDER", category: "Clock in / clock out", key: "prov.clock.before_clock_in", label: "Before clock in", trigger: "Provider is notified 1 hour before they need to clock in.", channels: { APP_PUSH: true } },
  // Chat
  { recipient: "PROVIDER", category: "Chat", key: "prov.chat.new_message", label: "New message", trigger: "Provider receives a new chat message while the app is in the background.", channels: { APP_PUSH: true } },

  // ─── PROPOSED ADDITIONS ───────────────────────────────────────────
  // Instant payouts
  { recipient: "ADMIN", category: "Instant payouts", key: "admin.payout.request_received", label: "Instant payout request received", trigger: "Provider requests an instant payout.", channels: { EMAIL: true, APP_PUSH: true, SMS: false } },
  { recipient: "PROVIDER", category: "Instant payouts", key: "prov.payout.request_received", label: "Instant payout request received", trigger: "Provider's instant payout request was received.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Instant payouts", key: "prov.payout.completed", label: "Instant payout completed", trigger: "Provider instant payout has been completed.", channels: { EMAIL: true, APP_PUSH: true } },
  // Chat (proposed)
  { recipient: "ADMIN", category: "Chat (proposed)", key: "admin.chat.customer_provider_msg", label: "New customer/provider chat message", trigger: "New customer or provider chat message needs attention.", channels: { EMAIL: true, APP_PUSH: true }, isProposed: true },
  { recipient: "CUSTOMER", category: "Chat (proposed)", key: "cust.chat.new_message", label: "New chat message", trigger: "Customer has a new chat message from admin or provider.", channels: { EMAIL: true, APP_PUSH: true, SMS: false }, isProposed: true },
  { recipient: "PROVIDER", category: "Chat (proposed)", key: "prov.chat.new_message_v2", label: "New chat message", trigger: "Provider has a new chat message from admin or customer.", channels: { EMAIL: true, APP_PUSH: true, SMS: false }, isProposed: true },
  // Documents / signatures
  { recipient: "ADMIN", category: "Documents / signatures (proposed)", key: "admin.docs.signature_request", label: "New document signature request", trigger: "A new document needs to be signed.", channels: { EMAIL: true, APP_PUSH: true }, isProposed: true },
  { recipient: "ADMIN", category: "Documents / signatures (proposed)", key: "admin.docs.signed_completed", label: "Signed document completed", trigger: "A requested document has been signed and completed.", channels: { EMAIL: true, APP_PUSH: true }, isProposed: true },
  // Provider reporting
  { recipient: "PROVIDER", category: "Provider reporting (proposed)", key: "prov.report.monthly_breakdown", label: "Monthly provider breakdown", trigger: "Provider's individual monthly breakdown of jobs, earnings, tips, deductions, ratings, and adjustments.", channels: { EMAIL: true }, isProposed: true },
  { recipient: "ADMIN", category: "Provider reporting (proposed)", key: "admin.report.monthly_generated", label: "Monthly provider breakdown generated", trigger: "Monthly provider breakdowns have been generated and sent.", channels: { EMAIL: true }, isProposed: true },
  // Weekly reports
  { recipient: "PROVIDER", category: "Provider reporting (proposed)", key: "prov.report.weekly_performance", label: "Weekly performance report", trigger: "Weekly summary of hours, jobs, and ratings for each provider.", channels: { EMAIL: true } },
  { recipient: "ADMIN", category: "Provider reporting (proposed)", key: "admin.report.weekly_ragwash", label: "Weekly Rag Wash dashboard", trigger: "Weekly summary of total rags used, payouts issued, and flagged jobs.", channels: { EMAIL: true } },
  // Monthly customer statement
  { recipient: "CUSTOMER", category: "Reports", key: "cust.reports.monthly_statement", label: "Monthly statement", trigger: "1st of every month: HTML email + PDF attachment of the previous month's bookings and payments.", channels: { EMAIL: true } },
  // Quote requests (public landing page)
  { recipient: "CUSTOMER", category: "Quotes", key: "cust.quote.received", label: "Quote request received", trigger: "Customer submits a quote request via the public landing page.", channels: { EMAIL: true } },
  { recipient: "ADMIN", category: "Quotes", key: "admin.quote.new_request", label: "New quote request", trigger: "A new quote request landed in the admin inbox.", channels: { EMAIL: true, APP_PUSH: true } },
  // Card hold lifecycle
  { recipient: "CUSTOMER", category: "Card holds", key: "cust.hold.placed", label: "Card hold placed", trigger: "A pre-authorisation hold for the full job price was placed on the customer's card at booking time.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Card holds", key: "cust.hold.released", label: "Card hold released", trigger: "Hold was released without capture (booking canceled).", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Card holds", key: "cust.hold.capture_failed", label: "Capture failed", trigger: "Capturing the hold at job completion failed and the card needs attention.", channels: { EMAIL: true } },
  // Gift cards
  { recipient: "CUSTOMER", category: "Gift cards", key: "cust.gift.purchase_receipt", label: "Gift card purchase receipt", trigger: "Buyer's receipt after a successful gift card purchase.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift cards", key: "cust.gift.delivery", label: "Gift card delivery", trigger: "Recipient receives the gift card via email.", channels: { EMAIL: true } },
  { recipient: "CUSTOMER", category: "Gift cards", key: "cust.gift.redeemed", label: "Gift card redeemed", trigger: "Recipient redeemed the code; account credit added.", channels: { EMAIL: true } },
  { recipient: "ADMIN", category: "Gift cards", key: "admin.gift.purchased", label: "Gift card purchased", trigger: "A new gift card was purchased.", channels: { EMAIL: true } },
  // Customer no-show
  { recipient: "CUSTOMER", category: "Booking fee charged & refund", key: "cust.fee.no_show", label: "No-show fee charged", trigger: "Customer was a no-show; $25 fee charged and auto 1-star applied.", channels: { EMAIL: true } },
  // Late arrival penalty
  { recipient: "ADMIN", category: "Clock in / clock out", key: "admin.clock.late_arrival", label: "Cleaner arrived late", trigger: "Cleaner clocked in more than 10 minutes after scheduled start time.", channels: { EMAIL: true, APP_PUSH: true } },
  { recipient: "PROVIDER", category: "Clock in / clock out", key: "prov.clock.late_arrival", label: "You arrived late", trigger: "Cleaner clocked in more than 10 minutes after scheduled start time; rating cap applied.", channels: { EMAIL: true, APP_PUSH: true } },
  // Last-minute reassignment
  { recipient: "PROVIDER", category: "Unassigned booking", key: "prov.unassigned.last_minute", label: "Last minute booking", trigger: "A cleaner cancelled last minute and the job is open for claim with a $10 bonus.", channels: { EMAIL: true, APP_PUSH: true, SMS: true } },
];
