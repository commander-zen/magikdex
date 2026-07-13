// otag values below are verified against the live Scryfall Tagger — never guess/add without manual verification.
export const SEARCH_CHIPS = [
  {
    id: "tokens",
    label: "Tokens",
    tags: ["repeatable-creature-tokens", "synergy-token", "repeatable-token-generator"],
  },
  {
    id: "plus1_counters",
    label: "+1/+1 Counters",
    tags: ["repeatable-pp-counters", "gives-pp-counters"],
  },
  {
    id: "artifacts",
    label: "Artifacts",
    tags: ["sacrifice-outlet-artifact", "synergy-artifact", "karnstructs", "repeatable-artifact-tokens", "synergy-artifact-creature"],
  },
  {
    id: "lifegain",
    label: "Lifegain",
    tags: ["lifegain-to-damage", "lifegain-matters", "lifegain", "repeatable-lifegain"],
  },
  {
    id: "aggro",
    label: "Aggro",
    tags: ["attack-trigger", "attacking-matters-self", "attacking-matters"],
  },
];
