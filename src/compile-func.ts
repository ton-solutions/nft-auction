import { promises } from "fs"
import path from "path"
import { compileFunc } from 'ton-compiler'

async function run() {
    const destination = path.join(__dirname, 'contracts')
    const files = await promises.readdir(destination)
    const funcFiles = files.filter(f => f.match(/.*\.fc$/))
    funcFiles.forEach(async (f) => {
        const content = await promises.readFile(path.resolve(destination, f))
            .then(f => f.toString('utf-8'))
        const { cell } = await compileFunc(content)
        const result = `
        module.exports = '${cell.toString('hex')}'
        `
        return promises.writeFile(
            path.resolve(destination, `${f}.compiled.js`),
            result
        )
    })
}

run()