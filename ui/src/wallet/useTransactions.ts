import { useCallback, useEffect, useRef, useState } from "react";
import { listTransactions, type Tx } from "./api";
import { nodeStatus } from "../bridge";

// A local cache so transactions appear instantly on open (before the node even
// answers), plus a background sync that pages new/updated ones in from the
// node's wallet — a fast local read, never a chain re-parse.
const CACHE_KEY = "dd69.txCache";
const MAX = 800; // how deep we backfill / cache
const PAGE = 100;

export type TxSyncState =
  | "loading"
  | "checking"
  | "parsing"
  | "uptodate"
  | "unreachable"
  | "syncing";

export interface TxStatus {
  state: TxSyncState;
  count?: number;
}

function loadCache(): Tx[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveCache(txs: Tx[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(txs.slice(0, MAX)));
  } catch {
    /* storage full/unavailable */
  }
}
const sortTx = (t: Tx[]) => [...t].sort((a, b) => b.time - a.time);
const keyOf = (t: Tx) => `${t.txid}:${t.address}:${t.amount}`;

export function useTransactions() {
  const initial = loadCache();
  const [txs, setTxs] = useState<Tx[]>(initial);
  const [status, setStatus] = useState<TxStatus>({ state: "loading" });
  const busy = useRef(false);
  const txsRef = useRef<Tx[]>(initial);
  txsRef.current = txs;

  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let phase = "";
      try {
        phase = (await nodeStatus()).phase;
      } catch {
        /* leave blank */
      }

      setStatus({ state: "checking" });
      const map = new Map<string, Tx>(txsRef.current.map((t) => [keyOf(t), t]));
      let from = 0;
      let parsed = 0;
      let failed = false;

      for (;;) {
        const page = await listTransactions(PAGE, from);
        if (page === null) {
          failed = true; // node unreachable
          break;
        }
        for (const t of page) {
          parsed++;
          map.set(keyOf(t), t);
        }
        const cur = sortTx([...map.values()]);
        setTxs(cur);
        txsRef.current = cur;
        setStatus({ state: "parsing", count: parsed });
        if (page.length < PAGE) break; // reached the end
        from += PAGE;
        if (from >= MAX) break;
      }

      if (failed) {
        setStatus({ state: phase === "syncing" ? "syncing" : "unreachable" });
      } else {
        const final = sortTx([...map.values()]);
        saveCache(final);
        setTxs(final);
        txsRef.current = final;
        setStatus({ state: "uptodate" });
      }
    } catch {
      setStatus({ state: "unreachable" });
    } finally {
      busy.current = false;
    }
  }, []);

  // A light, frequent poll of just the newest transactions, so an incoming tx
  // shows within a couple seconds and confirmations tick up live — without the
  // cost of the full history sync.
  const fastPoll = useCallback(async () => {
    try {
      const page = await listTransactions(15, 0);
      if (page === null) return;
      const map = new Map<string, Tx>(txsRef.current.map((t) => [keyOf(t), t]));
      for (const t of page) map.set(keyOf(t), t);
      const cur = sortTx([...map.values()]);
      setTxs(cur);
      txsRef.current = cur;
      saveCache(cur);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    sync();
    const idSlow = setInterval(sync, 60000);
    const idFast = setInterval(fastPoll, 3000);
    return () => {
      clearInterval(idSlow);
      clearInterval(idFast);
    };
  }, [sync, fastPoll]);

  return { txs, status, refresh: sync };
}
