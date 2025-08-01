const core = require("@actions/core")
const exec = require("@actions/exec")
const io = require("@actions/io")
const path = require("node:path")
const fs = require("node:fs")

/**
 *
 * @param {string} executable
 * @param {string[]} args
 * @async
 * @returns {Promise<string[]>}
 */
async function execAndGetStdout(executable, args) {
	/** @type {string} */
	let output = ""

	/** @type {exec.ExecOptions} */
	const options = {
		failOnStdErr: true,
		ignoreReturnCode: false,
		listeners: {
			stdout: (data) => {
				output += data.toString()
			},
		},
	}

	await io.which(executable, true)

	/** @type {number} */
	const exitCode = await exec.exec(executable, args, options)

	if (exitCode != 0) {
		throw new Error(`${executable} exited with exit code ${exitCode}`)
	}

	/** @type {string[]} */
	const result = output === "" ? [] : output.split("\n")

	return result
}

/**
 * @param {boolean} onlyGitFiles
 * @async
 * @returns {Promise<string[]>}
 */
async function getMesonFiles(onlyGitFiles) {
	/** @type {string[]} */
	let files = []

	/** @type {string[]} */
	const mesonFiles = ["meson.build", "meson.options", "meson_options.txt"]

	if (onlyGitFiles) {
		/** @type {string[]} */
		const gitFiles = mesonFiles.flatMap((file) => ["--exclude", file])

		files = await execAndGetStdout("git", [
			"ls-files",
			...gitFiles,
			"--ignored",
			"-c",
		])
	} else {
		/** @type {string[][]} */
		const findFiles = mesonFiles.map((file) => ["-name", file])

		/** @type {string[]} */
		const finalFindFiles = findFiles.reduce((acc, elem, index) => {
			if (index != 0) {
				acc.push("-o")
			}

			acc.push(...elem)

			return acc
		}, [])

		files = await execAndGetStdout("find", [
			".",
			"(",
			...finalFindFiles,
			")",
		])
	}

	/** @type {string[]} */
	let abs_files = []

	for (const file of files) {
		if (file === "") {
			continue;
		}

		/** @type {string | null} */
		const abs_file = resolveFilePath(file)

		if (abs_file === null) {
			break;
		}

		abs_files.push(abs_file)

	}

	return abs_files
}

/**
 *
 * @param {string} file
 * @param {string} formatFile
 * @async
 * @returns {Promise<boolean>}
 */
async function checkFile(file, formatFile) {
	/** @type {exec.ExecOptions} */
	const options = {
		ignoreReturnCode: true,
	}

	/** @type {string[]} */
	const additionalArgs = formatFile === "" ? [] : ["-c", formatFile]

	/** @type {number} */
	const exitCode = await exec.exec(
		"meson",
		["format", "--check-only", ...additionalArgs, file],
		options
	)

	return exitCode === 0
}

/**
 *
 * @param {string[]} items
 * @param {boolean} ordered
 * @returns {string}
 */
function getMarkdownListOf(items, ordered) {
	/** @type {string} */
	const itemsContent = items.map((item) => `<li>${item}</li>`).join("")

	/** @type {string} */
	const listType = ordered ? "ol" : "ul"

	return `<${listType}>${itemsContent}</${listType}>`
}

/**
 *
 * @param {string} file
 * @returns {string | null}
 */
function resolveFilePath(file) {
	/** @type {string} */
	let finalPath = file

	if (!path.isAbsolute(file)) {
		finalPath = path.resolve(process.cwd(), file)
	}

	if (!fs.existsSync(finalPath)) {
		return null
	}

	return finalPath
}

/**
 *
 * @param {string} file
 * @returns {string}
 */
function toRelativeFilePath(file) {

	if (!path.isAbsolute(file)) {
		return file;
	}

	return path.relative(process.cwd(), file)
}

/**
 * @async
 * @returns {Promise<void>}
 */
async function main() {
	try {
		/** @type {string} */
		const os = core.platform.platform

		if (os != "linux") {
			throw new Error(
				`Action atm only supported on linux: but are on: ${os}`
			)
		}

		/** @type {string} */
		const formatFileRaw = core.getInput("format-file", { required: false })

		/** @type {boolean} */
		const onlyGitFiles = core.getBooleanInput("only-git-files", {
			required: false,
		})

		/** @type {string | null} */
		const formatFile = resolveFilePath(formatFileRaw)

		if (formatFile === null) {
			throw new Error(
				`Meson format file '${formatFileRaw}' not found, please specify a valid file, current working directory, that was used to resolve this path was: ${process.cwd()}`
			)
		}

		/** @type {string[]} */
		const files = await getMesonFiles(onlyGitFiles)

		await io.which("meson", true)

		/** @type {string[]} */
		const notFormattedFiles = []

		core.startGroup("Check all files")

		//TODO: maybe parallelize this
		for (const file of files) {
			core.info(`Checking file: '${file}'`)

			/** @type {boolean} */
			const result = await checkFile(file, formatFile)

			core.info(
				result
					? "File is formatted correctly"
					: "File has formatting errors"
			)
			core.info("")

			if (!result) {
				notFormattedFiles.push(file)

				/** @type {core.AnnotationProperties} */
				const properties = {
					file,
					title: "File not formatted correctly",
				}

				core.error("File not formatted correctly", properties)
			}
		}

		core.endGroup()

		if (notFormattedFiles.length === 0) {
			core.summary.clear()

			core.summary.addHeading("Result", 1)
			core.summary.addRaw(
				":white_check_mark: All files are correctly formatted",
				true
			)

			core.summary.write({ overwrite: true })
			return
		}

		core.summary.clear()

		core.summary.addHeading("Result", 1)
		core.summary.addRaw(":x: Some files are not formatted correctly", true)
		core.summary.addBreak()

		/** @type {string} */
		const fileList = getMarkdownListOf(notFormattedFiles.map(file => toRelativeFilePath(file)), false)

		core.summary.addDetails("Affected Files", fileList)
		core.summary.addSeparator()

		core.summary.addRaw(
			"To format the files run the following command",
			true
		)
		core.summary.addBreak()

		/** @type {string} */
		const additionalArgs = formatFile === "" ? "" : `-c "${toRelativeFilePath(formatFile)}"`

		/** @type {string} */
		const finalFileList = notFormattedFiles
			.map((file) => `"${toRelativeFilePath(file)}"`)
			.join(" ")

		core.summary.addCodeBlock(
			`meson format ${additionalArgs} -i ${finalFileList}`,
			"bash"
		)

		core.summary.write({ overwrite: true })

		throw new Error("Some files are not formatted correctly")
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error)
		} else {
			core.setFailed(`Invalid error thrown: ${error}`)
		}
	}
}

main()
