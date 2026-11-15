import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { CONFIG_FILENAMES, STARTER_CONFIG } from '../services/config'

interface InitOptions {
  force?: boolean
}

/**
 * Write a configuration file for a project.
 *
 * The file says what to leave out of the analysis and which findings to
 * silence. It lives in the project, so it is reviewed with the code.
 */
export async function initCommand(
  projectPath: string = '.',
  options: InitOptions = {}
) {
  const resolved = path.resolve(projectPath)

  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`✗ ${resolved} does not exist.`))
    process.exitCode = 1
    return
  }

  if (!fs.statSync(resolved).isDirectory()) {
    console.error(chalk.red(`✗ ${resolved} is not a folder.`))
    process.exitCode = 1
    return
  }

  const target = path.join(resolved, CONFIG_FILENAMES[0])

  if (fs.existsSync(target) && !options.force) {
    console.log(
      chalk.yellow(`! ${CONFIG_FILENAMES[0]} already exists. Nothing was changed.`)
    )
    console.log(chalk.gray('  Use --force to replace it.'))
    return
  }

  try {
    fs.writeFileSync(target, STARTER_CONFIG, 'utf8')
    console.log(chalk.green(`✓ Wrote ${path.relative(process.cwd(), target) || target}`))
    console.log(
      chalk.gray('  List the paths to leave out under "ignore", and the rules to')
    )
    console.log(chalk.gray('  silence under "exclude" and "suppress".'))
  } catch (error) {
    console.error(
      chalk.red(
        `✗ Could not write the configuration: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    )
    process.exitCode = 1
  }
}
