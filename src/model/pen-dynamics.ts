export interface PenDynamicsProfile { pressureSensitivity: number; stabilization: number; }
export type PenDynamics = Partial<Record<"fountain" | "ball" | "brush" | "highlighter", PenDynamicsProfile>>;
export function penDynamicsProfile(value: unknown, type: string): PenDynamicsProfile {
  const all=value && typeof value === "object" ? value as Record<string,unknown> : {};
  const raw=all[type] && typeof all[type] === "object" ? all[type] as Record<string,unknown> : {};
  const clamp=(v:unknown,fallback:number)=>typeof v === "number" && Number.isFinite(v) ? Math.max(0,Math.min(1,v)) : fallback;
  return {pressureSensitivity:clamp(raw.pressureSensitivity,1),stabilization:clamp(raw.stabilization,0)};
}
