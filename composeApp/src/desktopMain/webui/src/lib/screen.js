import { createContext, useContext } from "react";

/** True while this screen is the one on display (kept-alive screens stay mounted but parked). */
export const ScreenActiveContext = createContext(true);
export const useScreenActive = () => useContext(ScreenActiveContext);
