/**
 * Helpers for Minecraft Java versions.
 *
 * Mojang moved from 1.x versions to year-based releases (26.1, 26.2, 26.3),
 * so plain string comparisons cannot order versions correctly anymore.
 */

const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?/;

/**
 * Parses a Minecraft version into numeric parts.
 * @param {string} version
 * @returns {{major: number, minor: number, patch: number}|null}
 */
export function parseMinecraftVersion(version) {
    const match = String(version ?? '').trim().match(VERSION_PATTERN);
    if (!match)
        return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3] ?? 0),
    };
}

/**
 * Compares two Minecraft versions.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a < b, positive when a > b, 0 when equal/unknown.
 */
export function compareMinecraftVersions(a, b) {
    const left = parseMinecraftVersion(a);
    const right = parseMinecraftVersion(b);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    return (left.major - right.major)
        || (left.minor - right.minor)
        || (left.patch - right.patch);
}

/**
 * Checks whether a server version is covered by a supported-version list.
 * Patch releases of a supported minor (26.1.1) are accepted, while 1.21.11
 * is not mistaken for 1.21.1.
 * @param {string} version
 * @param {string[]} supportedVersions
 * @returns {boolean}
 */
export function isMinecraftVersionSupported(version, supportedVersions = []) {
    if (!version)
        return false;
    return supportedVersions.some(supported =>
        version === supported
        || (version.startsWith(supported) && version.charAt(supported.length) === '.')
    );
}

/**
 * Returns the newest version from a list.
 * @param {string[]} versions
 * @returns {string|null}
 */
export function newestMinecraftVersion(versions = []) {
    if (versions.length === 0)
        return null;
    return [...versions].sort(compareMinecraftVersions).at(-1);
}
