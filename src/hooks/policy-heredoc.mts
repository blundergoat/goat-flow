/** Recognize existing non-shell stdin consumers before later opener and substitution inspection. */
const inertConsumers = new Set(
  (
    "cat tac tee head tail sort uniq wc nl rev cut tr fold fmt column paste join comm expand unexpand strings iconv " +
    "base64 base32 xxd hexdump od md5sum sha1sum sha256sum sha512sum cksum " +
    "grep egrep fgrep rg ag sed gsed awk gawk mawk nawk jq yq xq mlr " +
    "python python2 python3 php node nodejs deno ruby perl lua " +
    "psql mysql mariadb sqlite3 mongosh mongo redis-cli cqlsh duckdb " +
    "echo printf true false : mail mailx sendmail less more"
  ).split(" "),
);

/** Classify one normalized basename; interpreter-language behavior remains outside shell policy. */
export function isInertHeredocConsumer(firstWord: string): boolean {
  return inertConsumers.has(firstWord);
}

/** Trust stdin only for the three existing Goat Flow data commands, after caller normalization. */
export function goatFlowCliConsumesHeredocData(command: string): boolean {
  const separator = command.search(/[ \t\r\n\v\f]/u);
  const word = separator < 0 ? command : command.slice(0, separator);
  if (word.slice(word.lastIndexOf("/") + 1) !== "goat-flow") return false;
  const args = command.slice(word.length).replace(/^[ \t\r\n\v\f]+/u, "");
  return /^(quality[ \t\r\n\v\f]+save|review[ \t\r\n\v\f]+validate|redact)([ \t\r\n\v\f]|$)/u.test(
    args,
  );
}
