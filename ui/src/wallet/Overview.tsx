import { ActivityList } from "./ActivityList";
import { FastReceiveCard } from "./FastReceiveCard";

// Balances live in the header panel and node status in the corner panel, so the
// Overview's main area is the at-a-glance dashboard: live Fast Send arrivals
// (when any) on top, then recent activity.
export function Overview() {
  return (
    <>
      <FastReceiveCard />
      <ActivityList />
    </>
  );
}
