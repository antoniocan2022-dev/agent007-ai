// Executive migration adapter.
// Keep the DashboardTab contract so existing navigation/state wiring remains stable,
// while the user-facing Finance & Analytics tab uses the reality-first executive surface.
export { FinanceExecutiveTab as DashboardTab } from './finance-executive-tab'
