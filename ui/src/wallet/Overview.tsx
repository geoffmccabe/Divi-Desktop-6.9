import { ActivityList } from "./ActivityList";

// Balances live in the header panel and node status in the corner panel, so the
// Overview's main area is the at-a-glance dashboard: recent activity.
export function Overview() {
  return <ActivityList />;
}
