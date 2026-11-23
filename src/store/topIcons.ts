import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Quais indicadores aparecem ao lado do relógio, no topo das telas. */
export type TopIcon = "volume" | "network" | "bluetooth" | "controller";

export const TOP_ICONS: { id: TopIcon; label: string; hint: string }[] = [
  { id: "volume", label: "Volume", hint: "Volume do PC, ou \"Mudo\" quando está silenciado" },
  { id: "network", label: "Rede", hint: "Wi-Fi ou cabo de rede, e se há internet" },
  { id: "bluetooth", label: "Bluetooth", hint: "Aparece se o PC tem Bluetooth, com a quantidade de dispositivos conectados" },
  { id: "controller", label: "Bateria do controle", hint: "Controle sem fio com a bateria mais fraca" },
];

interface TopIconsStore {
  shown: Record<TopIcon, boolean>;
  setShown: (icon: TopIcon, shown: boolean) => void;
}

export const useTopIcons = create<TopIconsStore>()(
  persist(
    (set) => ({
      shown: { volume: true, network: true, bluetooth: true, controller: true },
      setShown: (icon, shown) => set((s) => ({ shown: { ...s.shown, [icon]: shown } })),
    }),
    { name: "launcher-top-icons" },
  ),
);
