export type MeridianAction = {
  type: string;
  payload?: any;
  meta?: Record<string, any>;
};

export type MeridianEffect = {
  effect: string;
  params?: Record<string, any>;
  onSuccess?: MeridianAction[];
  onError?: MeridianAction[];
};

export type MeridianTransitionTable = {
  [actionType: string]: MeridianEffect[];
};

export type MeridianDeclarativeContract = {
  initialState?: Record<string, any>;
  transitions: MeridianTransitionTable;
};
