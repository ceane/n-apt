import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_SIGNALS_PATH = "signals.yaml";
const DEFAULT_ARTICLE_PATH = "pages/how-do-they-do-it.md";
const DEFAULT_GENERATED_ARTICLE_PATH = "docs/pages/how-do-they-do-it.md";

const FREQUENCY_UNITS = {
  hz: 1,
  khz: 1e3,
  mhz: 1e6,
  ghz: 1e9,
};

function parseFrequencyToken(token) {
  const match = String(token).trim().match(/^(-?\d+(?:\.\d+)?)(Hz|kHz|MHz|GHz)$/i);
  if (!match) {
    throw new Error(`Unsupported frequency token: ${token}`);
  }

  const value = Number(match[1]);
  const multiplier = FREQUENCY_UNITS[match[2].toLowerCase()];
  const frequencyHz = value * multiplier;
  if (!Number.isFinite(frequencyHz)) {
    throw new Error(`Invalid frequency token: ${token}`);
  }
  return frequencyHz;
}

function formatDecimal(value) {
  return Number(value.toFixed(6)).toString();
}

function formatFrequencyHz(frequencyHz, withSpace = false) {
  const absoluteHz = Math.abs(frequencyHz);
  const unit = absoluteHz >= 1e9 ? "GHz" : absoluteHz >= 1e6 ? "MHz" : absoluteHz >= 1e3 ? "kHz" : "Hz";
  const divisor = FREQUENCY_UNITS[unit.toLowerCase()];
  return `${formatDecimal(frequencyHz / divisor)}${withSpace ? " " : ""}${unit}`;
}

function parseCanonicalChannels(signalsYaml) {
  const channelsMatch = /^  channels:\s*$/m.exec(signalsYaml);
  if (!channelsMatch) {
    throw new Error("Could not find the canonical signals.channels section in signals.yaml");
  }

  const channelsStart = channelsMatch.index + channelsMatch[0].length;
  const followingTopLevelSection = /^  \S/m.exec(signalsYaml.slice(channelsStart));
  const channelsEnd = followingTopLevelSection
    ? channelsStart + followingTopLevelSection.index
    : signalsYaml.length;
  const channelsText = signalsYaml.slice(channelsStart, channelsEnd);
  const entries = [...channelsText.matchAll(/^    ([A-Za-z0-9_-]+):\s*$/gm)];
  if (entries.length === 0) {
    throw new Error("signals.channels does not contain any channel entries");
  }

  const channels = entries.map((entry, index) => {
    const entryStart = entry.index + entry[0].length;
    const entryEnd = index + 1 < entries.length ? entries[index + 1].index : channelsText.length;
    const entryText = channelsText.slice(entryStart, entryEnd);
    const rangeMatch = /^      freq_range_hz:\s*!frequency_range\s+([^\s#]+)\.\.([^\s#]+)/m.exec(entryText);
    if (!rangeMatch) {
      throw new Error(`signals.channels.${entry[1]} is missing a !frequency_range value`);
    }
    const labelMatch = /^      label:\s*["']?([^"'\s#]+)["']?/m.exec(entryText);
    const label = labelMatch?.[1] || entry[1].toUpperCase();
    const minHz = parseFrequencyToken(rangeMatch[1]);
    const maxHz = parseFrequencyToken(rangeMatch[2]);
    if (minHz >= maxHz) {
      throw new Error(`signals.channels.${entry[1]} must have an increasing frequency range`);
    }

    return {
      id: entry[1],
      label,
      minHz,
      maxHz,
      centerHz: (minHz + maxHz) / 2,
      bandwidthHz: maxHz - minHz,
      rangeText: `${formatFrequencyHz(minHz)} to ${formatFrequencyHz(maxHz)}`,
      centerText: formatFrequencyHz((minHz + maxHz) / 2, true),
      bandwidthText: formatFrequencyHz(maxHz - minHz, true),
    };
  });

  const labels = new Set();
  for (const channel of channels) {
    if (labels.has(channel.label)) {
      throw new Error(`signals.channels contains duplicate label ${channel.label}`);
    }
    labels.add(channel.label);
  }
  return channels;
}

function replaceChannelNarrative(article, channels) {
  let updated = article;
  for (const channel of channels) {
    const marker = `data-channel-${channel.label.toLowerCase()}=`;
    const markedBlock = new RegExp(`(<div\\b[^>]*${marker}["'][^>]*>)([\\s\\S]*?)(</div>)`, "gi");
    updated = updated.replace(markedBlock, (match, openingTag, content, closingTag) => {
      const channelPattern = new RegExp(`Channel ${escapeRegExp(channel.label)}\\b`, "i");
      if (!channelPattern.test(content)) return match;
      const replacement = content
        .replace(/from `[^`]+`/, `from \`${channel.rangeText}\``)
        .replace(/from about `[^`]+`/i, (value) => `${value.slice(0, value.indexOf("`"))}\`${channel.rangeText}\``)
        .replace(/center frequency (?:of|is) `[^`]+`/, (value) => `${value.slice(0, value.indexOf("`") + 1)}${channel.centerText}\``)
        .replace(/bandwidth (?:of|is) `[^`]+`/, (value) => `${value.slice(0, value.indexOf("`") + 1)}${channel.bandwidthText}\``)
        .replace(/approximately `[^`]+`/, `approximately \`${formatDecimal(channel.bandwidthHz * 2 / 1e6)} MB/s\``);
      return `${openingTag}${replacement}${closingTag}`;
    });
  }
  return updated;
}

function replaceChannelTableBandwidths(article, channels) {
  const byLabel = new Map(channels.map((channel) => [channel.label.toUpperCase(), channel]));
  const inAirStart = article.indexOf('<div data-data-estimate="in-air"');
  const inPersonStart = article.indexOf('<div data-data-estimate="in-person"');
  const markedTable = /<div\b[^>]*data-channel-[a-z0-9_-]+=["'][^>]*>[\s\S]*?<\/div>/gi;

  return article.replace(markedTable, (table, offset) => {
    if (!/^\s*\|/m.test(table)) return table;
    const multiplier = inAirStart >= 0 && inPersonStart > inAirStart && offset > inAirStart && offset < inPersonStart ? 2 : 1;
    const model = table.includes("Raw `u8` I/Q MB/s") ? "u8" : table.includes("Raw `u16` I/Q MB/s") ? "u16" : null;
    const rateMultiplier = model === "u16" ? 5 : 1;
    const totalBandwidthHz = channels.reduce((total, channel) => total + channel.bandwidthHz, 0) * multiplier;
    const totalRateMbs = (channels.reduce((total, channel) => total + channel.bandwidthHz, 0) / 1e6) * rateMultiplier;

    return table.split("\n").map((line) => {
      if (!line.startsWith("|")) return line;
      const cells = line.split("|");
      const label = cells[1]?.trim();
      if (label === "Channel" || label === "---") return line;

      const channel = byLabel.get(label?.toUpperCase());
      const isTotal = label === "**Total**";
      if (!channel && !isTotal) return line;

      const bandwidthHz = channel ? channel.bandwidthHz * multiplier : totalBandwidthHz;
      cells[2] = ` ${formatFrequencyHz(bandwidthHz, true)} `;
      if (model) {
        const rateMbs = channel ? (channel.bandwidthHz / 1e6) * rateMultiplier : totalRateMbs;
        cells[3] = ` ~${formatDecimal(rateMbs)} MB/s `;
        const durations = [300, 3600, 10800, 86400];
        durations.forEach((seconds, index) => {
          if (cells[index + 4] !== undefined) cells[index + 4] = ` ~${formatStorage(rateMbs, seconds)} `;
        });
      }
      return cells.join("|");
    }).join("\n");
  });
}

function formatStorage(rateMbs, seconds) {
  const gigabytes = rateMbs * seconds / 1000;
  if (gigabytes >= 1000) return `${(gigabytes / 1000).toFixed(2)} TB`;
  if (gigabytes >= 100) return `${gigabytes.toFixed(1)} GB`;
  if (gigabytes >= 10) return `${gigabytes.toFixed(1)} GB`;
  return `${gigabytes.toFixed(2)} GB`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function synchronizeArticleText(article, signalsYaml) {
  const channels = parseCanonicalChannels(signalsYaml);
  for (const channel of channels) {
    const marker = new RegExp(`data-channel-${escapeRegExp(channel.label.toLowerCase())}=["']`, "i");
    if (!marker.test(article)) {
      throw new Error(`The article is missing a data-channel-${channel.label.toLowerCase()} marker`);
    }
  }
  const updated = replaceChannelTableBandwidths(replaceChannelNarrative(article, channels), channels);
  const totalBandwidthMbs = channels.reduce((total, channel) => total + channel.bandwidthHz, 0) / 1e6;
  const minRawMbs = formatDecimal(totalBandwidthMbs * 2);
  const maxRawMbs = formatDecimal(totalBandwidthMbs * 4);
  return updated
    .replace(
      /The resulting network raw-content estimates are approximately \*\*[^*]+ MB\/s\nminimum\*\* and \*\*[^*]+ MB\/s maximum\*\*\./,
      `The resulting network raw-content estimates are approximately **${formatDecimal(totalBandwidthMbs)} MB/s\nminimum** and **${minRawMbs} MB/s maximum**.`,
    )
    .replace(/- Minimum raw content: approximately `[^`]+ MB\/s`+/, `- Minimum raw content: approximately \`${minRawMbs} MB/s\``)
    .replace(/- Maximum raw content: approximately `[^`]+ MB\/s`+/, `- Maximum raw content: approximately \`${maxRawMbs} MB/s\``)
    .replace(/- Write→read minimum: approximately `[^`]+ MB\/s`+/, `- Write→read minimum: approximately \`${maxRawMbs} MB/s\``)
    .replace(/- Write→read maximum: approximately `[^`]+ MB\/s`+/, `- Write→read maximum: approximately \`${formatDecimal(totalBandwidthMbs * 8)} MB/s\``);
}

function resolvePath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function synchronizeFile(filePath, signalsYaml, { write }) {
  const original = fs.readFileSync(filePath, "utf8");
  const updated = synchronizeArticleText(original, signalsYaml);
  if (original === updated) return false;

  if (write) {
    fs.writeFileSync(filePath, updated, "utf8");
  }
  return true;
}

export function synchronizeArticleFiles({ root = process.cwd(), signalsPath = DEFAULT_SIGNALS_PATH, articlePaths, write = false }) {
  const resolvedSignalsPath = resolvePath(root, signalsPath);
  const signalsYaml = fs.readFileSync(resolvedSignalsPath, "utf8");
  const paths = articlePaths || [DEFAULT_ARTICLE_PATH, DEFAULT_GENERATED_ARTICLE_PATH];
  const changedPaths = [];

  for (const articlePath of paths) {
    const resolvedArticlePath = resolvePath(root, articlePath);
    if (!fs.existsSync(resolvedArticlePath)) continue;
    if (synchronizeFile(resolvedArticlePath, signalsYaml, { write })) {
      changedPaths.push(resolvedArticlePath);
    }
  }

  return changedPaths;
}

function parseArgs(argv) {
  const options = { root: process.cwd(), signalsPath: DEFAULT_SIGNALS_PATH, articlePaths: undefined, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--check") options.write = false;
    else if (argument === "--root") options.root = argv[++index];
    else if (argument === "--signals") options.signalsPath = argv[++index];
    else if (argument === "--article") options.articlePaths = [argv[++index]];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const changedPaths = synchronizeArticleFiles(options);
    if (changedPaths.length === 0) {
      console.log("Article channel frequencies are synchronized.");
      process.exit(0);
    }

    for (const changedPath of changedPaths) console.log(`${options.write ? "Updated" : "Out of date"}: ${path.relative(options.root, changedPath)}`);
    if (!options.write) {
      console.error("Run the synchronizer with --write to update the article.");
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
