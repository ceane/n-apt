export function removeActiveChild<T>(children: T[], child: T): void {
  let index = children.indexOf(child);
  while (index !== -1) {
    children.splice(index, 1);
    index = children.indexOf(child);
  }
}
