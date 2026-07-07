interface GraphTask {
  id: string
  depends_on: string[]
}

/** DFS visitation state used for cycle detection (white/gray/black coloring). */
type NodeColor = 'unvisited' | 'in-progress' | 'done'

/**
 * Deterministically detects cycles in a task dependency graph.
 *
 * Pure function: no I/O, no mutation of input, deterministic output for
 * identical input.
 *
 * @param tasks - list of tasks, each with an id and its depends_on edges
 * @returns an array of cycles, where each cycle is an array of task ids
 *          that form a cycle (in traversal order). Returns [] if the
 *          graph is acyclic.
 */
export function detectCycles(tasks: GraphTask[]): string[][] {
  const depsById = new Map<string, string[]>()
  const color = new Map<string, NodeColor>()
  for (const task of tasks) {
    depsById.set(task.id, task.depends_on)
    color.set(task.id, 'unvisited')
  }

  const cycles: string[][] = []
  const seenCycleKeys = new Set<string>()
  const stack: string[] = []

  function recordCycleStartingAt(dep: string): void {
    const startIndex = stack.indexOf(dep)
    const cycle = stack.slice(startIndex)
    const key = [...cycle].sort().join(',')
    if (!seenCycleKeys.has(key)) {
      seenCycleKeys.add(key)
      cycles.push(cycle)
    }
  }

  function visit(id: string): void {
    color.set(id, 'in-progress')
    stack.push(id)

    for (const dep of depsById.get(id) ?? []) {
      const depColor = color.get(dep)
      if (depColor === 'unvisited') {
        visit(dep)
      } else if (depColor === 'in-progress') {
        recordCycleStartingAt(dep)
      }
      // 'done' or missing (dep not a known task node): nothing to do.
    }

    stack.pop()
    color.set(id, 'done')
  }

  for (const task of tasks) {
    if (color.get(task.id) === 'unvisited') {
      visit(task.id)
    }
  }

  return cycles
}
