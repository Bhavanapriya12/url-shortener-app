const { nanoid } = require("nanoid");
const crypto = require("crypto");

function shortenUrl() {
  // Generate a unique short URL
  const shortUrl = nanoid(6);
  return shortUrl;
}

function get_random_string(str, length, pre_append = false) {
  if (str === "0")
    return crypto
      .randomBytes(Number(length / 2))
      .toString("hex")
      .toUpperCase();
  else if (pre_append) {
    return (
      str +
      crypto
        .randomBytes(Number(length / 2))
        .toString("hex")
        .toUpperCase()
    );
  }
  return (
    crypto
      .randomBytes(Number(length / 2))
      .toString("hex")
      .toUpperCase() + str
  );
}
module.exports = { shortenUrl, get_random_string };
