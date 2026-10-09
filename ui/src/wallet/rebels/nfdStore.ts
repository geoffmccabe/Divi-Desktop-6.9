// The one line that ties the game-agnostic NFD code to THIS game's database.
//
// ui/src/nfd/ knows nothing about Divi Rebels on purpose, and takes its two
// database functions as arguments. This is the file that supplies them, and it
// is the whole of what the next game has to write for itself.

import { accountRead, accountCall } from "./rebelsAccount";
import type { NfdStore } from "../../nfd/nfdRemote";

export const nfdStore: NfdStore = {
  read: (pathAndQuery) => accountRead(pathAndQuery),
  call: (fn, args) => accountCall(fn, args),
};
