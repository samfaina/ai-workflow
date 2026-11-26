// Seam: aw-intake's performance pre-step, the text an agent follows when it
// measures a baseline and reports it. These tests hold the rules tickets #235
// and #238 name: the median is compared with the figure the task states, the
// report claims only what the recorded numbers show, and the metric, workload
// and target are asked of the user, never reported as a failed agreement when
// nothing was asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillLine, skillSection } from './fixtures.mjs';

const baseline = skillSection('aw-intake/PRE-STEPS.md', '## Performance: baseline', '## Investigation: answer, changing nothing');

test('the baseline compares the median with the figure the task states, and the report gives both when they differ', () => {
  assert.match(baseline, /When the task states a figure for the problem \(a time, a rate, a size\), compare the median with it, and say in the report whether they match\./);
  assert.match(baseline, /When they differ, give both numbers, and never present the baseline as confirming the task\./);
  assert.match(baseline, /That figure is what the task says the problem is, not the target agreed in step 1\./);
  assert.match(baseline, /When the task states no figure, skip this step\./);
});

test('a tail value that matches the figure is named as the tail, not as the usual case', () => {
  assert.match(baseline, /A tail value that matches the figure, such as the maximum or a p99, is named as the tail, not as the usual case\./);
});

test('the report claims only what the recorded numbers show, such as a count of slow requests only when the measurement recorded it', () => {
  assert.match(baseline, /The report states only what the recorded numbers show: quote a count or share of slow runs or requests only when the measurement recorded it\./);
  assert.match(baseline, /A maximum above a threshold shows that at least one passed it, not how many\./);
});

test('the baseline asks the user the metric, the workload and the target, one question at a time, before writing the measurement', () => {
  assert.match(baseline, /^1\. Before writing the measurement, ask the user, one question at a time, what to measure \(latency, throughput, memory, size, …\), the workload that exercises the slow path, and the target, when they have one\./m);
  assert.match(baseline, /A choice the task already settles, such as latency when it gives a time, is offered as the recommended answer, not skipped\./);
});

test('the report never claims a failed agreement on a value that was not asked', () => {
  assert.match(baseline, /Never report that you could not agree a value with the user unless you asked and got no usable answer; a value you did not ask is reported as assumed\./);
});

test('the baseline is done only when the metric, workload and target were agreed and the report sets the median beside the figure the task states', () => {
  assert.match(baseline, /^Done when the user has agreed the metric, the workload and the target \(or that there is none\), the file holds at least five runs of one command, and the report quotes the median and the spread, and, when the task states a figure, that figure beside the median and whether they match\.$/m);
});

test("intake's report template asks for the baseline's median and spread, beside the figure the task states", () => {
  const line = skillLine('aw-intake', '**Pre-step:**');
  assert.match(line, /the baseline's median and spread \(with the figure the task states, when it states one, and whether they match\), or "none">$/);
});
