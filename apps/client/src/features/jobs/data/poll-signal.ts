/**
 * Module-level counter incremented while a job drawer is open. Read by the
 * jobs-list collection's refetchInterval callback to boost cadence from 10s
 * to 5s while a drawer holds focus.
 */
export const drawerOpenSignal = {
  count: 0,
};

export function incrementDrawerOpen(): void {
  drawerOpenSignal.count += 1;
}

export function decrementDrawerOpen(): void {
  drawerOpenSignal.count = Math.max(0, drawerOpenSignal.count - 1);
}
