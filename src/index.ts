import { redBright, greenBright } from "chalk";
import { getBooleanInput, setOutput } from "@actions/core";
import { exec } from "@actions/exec";
import { mkdirP, rmRF } from "@actions/io";
import { spawn } from "child_process";
import { resolve } from "node:path";
import { saveCache, restoreCache } from "@actions/cache";
import { type } from "node:os";
import { glob } from "glob";
import { readFile } from "fs/promises";
import { createHash } from "crypto";

const paths = ["/go/pkg/mod"];

function trygetBooleanInput(n: string) {
    try {
        return getBooleanInput(n);
    } catch {
        return false;
    }
}

function error(msg: string) {
    console.error(`${redBright("ERROR")}: ${msg}`);
    return process.exit(1);
}

function info(msg: string) {
    console.log(`${greenBright("INFO")}: ${msg}`);
}

async function $(
    cmd: string,
    env: Record<string, string> | undefined = undefined,
    shell = false,
): Promise<undefined> {
    if (shell) {
        const cp = spawn(cmd, { stdio: "inherit", env, shell: true });
        return new Promise((resolve) => {
            cp.once("exit", (code) => {
                if (code !== 0) {
                    error(`command didn't exit successfully(${code}): ${cmd}`);
                }
                return resolve(undefined);
            });
        });
    }
    const code = await exec(cmd, undefined, {
        env,
    });
    if (code !== 0) {
        error(`command didn't exit successfully(${code}): ${cmd}`);
    }
    return undefined;
}
const restoreKeys = [`${type()}-CrossBuild-`];

async function doInstallGo() {
    const doInstall = trygetBooleanInput("install-go");
    if (doInstall) {
        await $("wget https://go.dev/dl/go1.21.3.linux-amd64.tar.gz");
        await $("sudo tar -C /usr/local -xzf go1.21.3.linux-amd64.tar.gz");
        await $("/usr/local/go/bin/go version");
    }
}

async function main() {
    const willCache = getBooleanInput("cache");
    if (willCache) {
        const key = `${type()}-CrossBuild-${await hashFiles()}`;
        const cacheKey = await restoreCache(paths.slice(), key, restoreKeys);
        info(
            `restored cache with ${
                cacheKey ? `id ${cacheKey}` : "no cache hit"
            }`,
        );
        info(
            `primary key was: ${key}, additional keys were: ${restoreKeys.join(
                ",",
            )}`,
        );
    }
    await doInstallGo();
    await $("sudo apt-get update");
    await $(
        "sudo apt-get install gcc-aarch64-linux-gnu gcc-x86-64-linux-gnu -y",
    );
    let env: Record<string, string> = {};
    if (willCache) {
        env = {
            ...env,
            CARGO_INCREMENTAL: "1",
            GOPATH: "/go",
        };
    }
    await $("sudo /usr/local/go/bin/go build -o ./target/aarch64/bin", {
        ...env,
        GOOS: "linux",
        GOARCH: "arm64",
    });
    await $("sudo /usr/local/go/bin/go build -o ./target/x86-64/bin", {
        ...env,
        GOOS: "linux",
        GOARCH: "amd64",
    });
    await rmRF("./.out");
    await mkdirP("./.out");
    await mkdirP("./.out/aarch64");
    await mkdirP("./.out/x86-64");
    await $(
        `aarch64-linux-gnu-strip target/aarch64 -o ./.out/aarch64/bin`,
        undefined,
        true,
    );
    await $(
        `x86_64-linux-gnu-strip target/x86-64 -o ./.out/x86-64/bin`,
        undefined,
        true,
    );
    if (willCache) {
        const key = `${type()}-CrossBuild-${await hashFiles()}`;
        const _cacheId = await saveCache(paths.slice(), key);
    }
    const outResolved = resolve("./.out");
    setOutput("file", outResolved);
}

async function hashFiles() {
    const locks = await glob("**/go.sum");
    const hash = createHash("sha256");
    for (const path of locks) {
        const content = await readFile(path);
        hash.write(content);
    }
    return hash.digest("base64url");
}

main();
