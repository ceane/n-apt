/**
 * A singleton registry for storing File objects that shouldn't be in Redux.
 * This allows us to keep only serializable IDs in the Redux state.
 */
class FileRegistry {
  private files: Map<string, File> = new Map();

  /**
   * Register a File and return a unique ID.
   * If the file is already registered, returns the existing ID.
   */
  register(file: File): string {
    // Generate an ID based on name and size as a heuristic, 
    // or use a random UUID if we want more uniqueness.
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    this.files.set(id, file);
    return id;
  }

  /**
   * Get a File by its ID.
   */
  get(id: string): File | undefined {
    return this.files.get(id);
  }

  /**
   * Remove a File from the registry.
   */
  remove(id: string): void {
    this.files.delete(id);
  }

  /**
   * Clear all files from the registry.
   */
  clear(): void {
    this.files.clear();
  }
}

export const fileRegistry = new FileRegistry();
