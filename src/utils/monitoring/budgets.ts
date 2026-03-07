export type BudgetRating = 'good' | 'needs-improvement' | 'poor';

export interface PerfBudgets {
  LCP: number; // ms
  FID: number; // ms
  CLS: number; // unitless
  FCP: number; // ms
  TTFB: number; // ms
}

export const defaultBudgets: PerfBudgets = {
  LCP: 2500,
  FID: 100,
  CLS: 0.1,
  FCP: 1800,
  TTFB: 800,
};

export function rateMetric(name: keyof PerfBudgets, value: number, budgets: PerfBudgets = defaultBudgets): BudgetRating {
  const limit = budgets[name];
  if (name === 'CLS') {
    if (value <= limit) return 'good';
    if (value <= 0.25) return 'needs-improvement';
    return 'poor';
  }
  if (value <= limit) return 'good';
  if (name === 'FID') return value <= 300 ? 'needs-improvement' : 'poor';
  if (name === 'LCP') return value <= 4000 ? 'needs-improvement' : 'poor';
  if (name === 'FCP') return value <= 3000 ? 'needs-improvement' : 'poor';
  if (name === 'TTFB') return value <= 1800 ? 'needs-improvement' : 'poor';
  return 'good';
}

export function isOverBudget(name: keyof PerfBudgets, value: number, budgets: PerfBudgets = defaultBudgets) {
  return rateMetric(name, value, budgets) !== 'good';
}


