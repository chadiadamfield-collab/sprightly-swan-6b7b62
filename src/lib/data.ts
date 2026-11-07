/**
 * Façade unique de données : l'UI importe UNIQUEMENT ce module.
 * VITE_DATA_MODE=demo (défaut) → données fictives locales ; supabase → base réelle.
 * Toutes les actions sont asynchrones dans les deux modes.
 */
import { DATA_MODE } from "./supabase";
import * as demo from "./demo-store";
import * as sb from "./supabase-store";
import { historyIn, type HistoryEvent } from "./lookup";

export type { HistoryEvent };

export type { Checklist, DB } from "./demo-store";
export { AppError } from "./demo-store";
const live = DATA_MODE === "supabase";

function route<A extends unknown[], R>(d: (...a: A) => R, s: (...a: A) => Promise<R> | R) {
  return async (...a: A): Promise<R> => (live ? await s(...a) : d(...a));
}

export const useDB = live ? sb.useDB : demo.useDB;
export const getDB = live ? sb.getDB : demo.getDB;
export const resolveToken = live ? sb.resolveToken : demo.resolveToken;
export const findCheckoutItem = live ? sb.findCheckoutItem : demo.findCheckoutItem;
export const findReturnItem = live ? sb.findReturnItem : demo.findReturnItem;
export const resetDemo = live ? sb.resetDemo : demo.resetDemo;

export const signIn = route(demo.signIn, sb.signIn);
export const signUp = route<[string, string, string, string], "ok" | "confirm">((n, e, p, pw) => {
  demo.signUp(n, e, p, pw);
  return "ok";
}, sb.signUp);
export const signOut = route(demo.signOut, sb.signOut);
export const resetPassword = route((_email: string): void => undefined, sb.resetPassword);
export const updatePassword = route((_pw: string): void => undefined, sb.updatePassword);
export const updateOwnProfile = route(demo.updateOwnProfile, sb.updateOwnProfile);
export const contestBlock = route(demo.contestBlock, sb.contestBlock);
export const createReservation = route(demo.createReservation, sb.createReservation);
export const cancelReservation = route(demo.cancelReservation, sb.cancelReservation);
export const decideReservation = route(demo.decideReservation, sb.decideReservation);
export const confirmCheckout = route(demo.confirmCheckout, sb.confirmCheckout);
export const reportIncident = route(demo.reportIncident, sb.reportIncident);
export const confirmReturn = route(demo.confirmReturn, sb.confirmReturn);
export const directCheckout = route(demo.directCheckout, sb.directCheckout);
export const upsertEquipment = route(demo.upsertEquipment, sb.upsertEquipment);
export const setEquipmentStatus = route(demo.setEquipmentStatus, sb.setEquipmentStatus);
export const addLocation = route(demo.addLocation, sb.addLocation);
export const resolveIncident = route(demo.resolveIncident, sb.resolveIncident);
export const setBlocked = route(demo.setBlocked, sb.setBlocked);
export const setRole = route(demo.setRole, sb.setRole);
export const updateSettings = route(demo.updateSettings, sb.updateSettings);
export const markNotificationsRead = route(demo.markNotificationsRead, sb.markNotificationsRead);
export const runScheduler = route(demo.runScheduler, sb.runScheduler);
export const reload = route((): void => undefined, sb.loadAll);
export const takeIncident = route(demo.takeIncident, sb.takeIncident);
export const getEquipmentHistory = route(
  (id: string): HistoryEvent[] => historyIn(demo.getDB(), id),
  sb.getEquipmentHistory,
);
