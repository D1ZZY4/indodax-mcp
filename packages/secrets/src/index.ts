const SENSITIVE_KEYS = ["api_secret", "api-secret", "authorization", "bearer", "sign"];

export class SecretValue {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  expose(): string {
    return this.value;
  }

  isEmpty(): boolean {
    return this.value.length === 0;
  }

  fingerprint(): string {
    if (this.value.length <= 8) return "****";
    return `${this.value.slice(0, 4)}****${this.value.slice(-4)}`;
  }

  toJSON(): string {
    return "********";
  }

  toString(): string {
    return this.value.length === 0 ? "" : "********";
  }
}

export function redact(text: string): string {
  const lowered = text.toLowerCase();
  for (const key of SENSITIVE_KEYS) {
    if (lowered.includes(key)) return `[redacted ${key} content]`;
  }
  return text;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_KEYS.some((key) => name.toLowerCase().includes(key))
      ? "[redacted]"
      : value;
  }
  return out;
}
