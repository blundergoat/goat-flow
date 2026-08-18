/** Structured error with an exit code for CLI process termination. */
export class CLIError extends Error {
  /**
   * Carry the process exit code beside the message, so the CLI can fail with the status a script is checking for.
   *
   * @param message - text shown to the user on stderr
   * @param exitCode - status the process should exit with
   */
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
  }
}
