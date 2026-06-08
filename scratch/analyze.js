function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

function getCoreTitle(title) {
  if (!title) return "";
  const decoded = decodeHtmlEntities(title);
  return decoded
    .toLowerCase()
    .replace(/(?:season\s*\d+|s\d+|\d+(?:nd|rd|th|st)?\s*season|\d+(?:nd|rd|th|st)?\s*sseason)/gi, "")
    .replace(/\b(?:the\s+)?(?:movie|film|ova|ona|special|part)\b\s*\d*/gi, "")
    .replace(/\b(?:i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/i, "")
    .replace(/\b\d+\b\s*$/gi, "")
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio|uncut)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

const target = "The Seven Deadly Sins: Cursed by Light";
const text = "The Seven Deadly Sins the Movie 2: Cursed by Light";

const targetCore = getCoreTitle(target);
const textCore = getCoreTitle(text);

console.log("targetCore:", targetCore);
console.log("textCore:", textCore);
console.log("textCore === targetCore:", textCore === targetCore);
console.log("textCore.includes(targetCore):", textCore.includes(targetCore));
console.log("targetCore.includes(textCore):", targetCore.includes(textCore));
