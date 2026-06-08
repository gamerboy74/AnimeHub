import { extractSeasonNumber } from '../../server/utils/seasonExtractor.js';

const t1 = "The Seven Deadly Sins: Cursed by Light";
const t2 = "The Seven Deadly Sins the Movie 2: Cursed by Light";

console.log("t1 season:", extractSeasonNumber(t1));
console.log("t2 season:", extractSeasonNumber(t2));
