// lib/casinoConfig.ts
export type CasinoGameId =
  | "slots"
  | "dice"
  | "roulette"
  | "highlow"
  | "cointoss"
  | "crash";


export type CasinoGameConfig = {
  id: CasinoGameId;
  name: string;
  description: string;
  route: string;
  enabled: boolean;
};

export const HOUSE_POOL_PCT = 0.30; // 10% always reserved for the house
export const ROULETTE_POOL_PCT = 0.20; // 10% dedicated to roulette

export const CASINO_GAMES: CasinoGameConfig[] = [
  {
    id: "slots",
    name: "Slots",
    description: "Spin to win big.",
    route: "/slots",
    enabled: true,
  },
  {
    id: "dice",
    name: "Dice Roll",
    description: "Roll the dice and call it.",
    route: "/dice",
    enabled: true,
  },
  {
    id: "roulette",
    name: "Roulette",
    description: "Classic wheel, big swings.",
    route: "/roulette",
    enabled: true,
  },
  {
    id: "highlow",
    name: "High / Low",
    description: "Higher or lower than the draw.",
    route: "/highlow",
    enabled: true,
  },
  {
    id: "cointoss",
    name: "Coin Toss",
    description: "Heads or tails, your call.",
    route: "/cointoss",
    enabled: true,
  },
  {
    id: "crash",
    name: "Crash",
    description: "Ride the multiplier and cash out before it crashes.",
    route: "/crash",
    enabled: true,
  },
];
