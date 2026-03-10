import React from 'react';
import { initialMockState } from './services/mockData';
import { SimulationState } from './types';

export const StateContext = React.createContext<{
  state: SimulationState;
  dispatch: (action: any) => void;
}>({ state: initialMockState, dispatch: () => {} });
