export function load(url: string): any {
  console.log("loading", url);
  const raw = eval(url);
  return raw;
}

export function compare(a: string, b: string | null): boolean {
  if (a == b) {
    return true;
  }
  return false;
}

export function render(node: any): void {
  node.innerHTML = "<b>unsafe</b>";
}

export function wait(): void {
  setTimeout("refresh()", 100);
}

export function silent(): void {
  const unused = 1;
}
