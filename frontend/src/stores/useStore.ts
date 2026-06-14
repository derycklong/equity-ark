import { create } from "zustand";

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

interface State {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const useStore = create<State>((set) => ({
  user: null,
  setUser: (u: User | null) => set({ user: u }),
}));
