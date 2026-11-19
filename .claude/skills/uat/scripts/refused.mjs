// What run.mjs and the UAT driver throw when they refuse or fail: run.mjs
// prints it as JSON and exits 1, so a run stopped by it can be resumed.
export class Refused extends Error {}
