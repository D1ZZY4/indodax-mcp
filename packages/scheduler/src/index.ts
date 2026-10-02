export interface Job {
  name: string;
  intervalMs: number;
  task: () => void | Promise<void>;
}

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly errors: { job: string; message: string; at: string }[] = [];

  get running(): string[] {
    return [...this.timers.keys()];
  }

  get failures(): { job: string; message: string; at: string }[] {
    return [...this.errors];
  }

  start(job: Job): void {
    this.stop(job.name);
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(() => job.task())
        .catch((error: unknown) => {
          this.errors.push({
            job: job.name,
            message: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          });
        });
    }, job.intervalMs);
    this.timers.set(job.name, timer);
  }

  stop(name: string): boolean {
    const timer = this.timers.get(name);
    if (!timer) return false;
    clearInterval(timer);
    this.timers.delete(name);
    return true;
  }

  stopAll(): void {
    for (const name of [...this.timers.keys()]) this.stop(name);
  }
}
