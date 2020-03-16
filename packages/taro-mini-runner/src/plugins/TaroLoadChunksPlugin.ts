import * as path from 'path'

import webpack from 'webpack'
import { ConcatSource } from 'webpack-sources'
import { urlToRequest } from 'loader-utils'
import { toDashed } from '@tarojs/shared'
import { promoteRelativePath, META_TYPE, REG_STYLE, BUILD_TYPES, taroJsComponents } from '@tarojs/runner-utils'

import { componentConfig } from '../template/component'
import { AddPageChunks } from '../utils/types'

const PLUGIN_NAME = 'TaroLoadChunksPlugin'

interface IOptions {
  commonChunks: string[],
  buildAdapter: BUILD_TYPES,
  isBuildPlugin: boolean,
  framework: string,
  addChunkPages?: AddPageChunks
}

export default class TaroLoadChunksPlugin {
  commonChunks: string[]
  buildAdapter: BUILD_TYPES
  isBuildPlugin: boolean
  framework: string
  addChunkPages?: AddPageChunks

  constructor (options: IOptions) {
    this.commonChunks = options.commonChunks
    this.buildAdapter = options.buildAdapter
    this.isBuildPlugin = options.isBuildPlugin
    this.framework = options.framework
    this.addChunkPages = options.addChunkPages
  }

  apply (compiler: webpack.Compiler) {
    let pagesList
    const addChunkPagesList = new Map<string, string[]>();
    (compiler.hooks as any).getPages.tap(PLUGIN_NAME, pages => {
      pagesList = pages
    })
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: any) => {
      let commonChunks
      compilation.hooks.afterOptimizeChunks.tap(PLUGIN_NAME, (chunks: webpack.compilation.Chunk[]) => {
        commonChunks = chunks.filter(chunk => this.commonChunks.includes(chunk.name)).reverse()

        for (const chunk of commonChunks) {
          let needBreak = false;
          (chunk.modulesIterable as Set<unknown>).forEach((m: { rawRequest: string, usedExports: string[] }) => {
            if (m.rawRequest === taroJsComponents) {
              const includes = componentConfig.includes
              m.usedExports && m.usedExports.map(toDashed).map(includes.add.bind(includes))
              needBreak = true
            }
          })
          if (needBreak) {
            break
          }
        }
      })
      compilation.chunkTemplate.hooks.renderWithEntry.tap(PLUGIN_NAME, (modules, chunk) => {
        if (chunk.entryModule) {
          if (this.isBuildPlugin) {
            return addRequireToSource(getIdOrName(chunk), modules, commonChunks)
          }
          let entryModule = chunk.entryModule.rootModule ? chunk.entryModule.rootModule : chunk.entryModule
          if (entryModule.miniType === META_TYPE.ENTRY) {
            compilation.hooks.afterOptimizeAssets.tap(PLUGIN_NAME, assets => {
              const files = chunk.files
              files.forEach(item => {
                if (REG_STYLE.test(item)) {
                  const source = new ConcatSource()
                  const _source = assets[item]._source || assets[item]._value
                  Object.keys(assets).forEach(assetName => {
                    const fileName = path.basename(assetName, path.extname(assetName))
                    if (REG_STYLE.test(assetName) && this.commonChunks.includes(fileName)) {
                      source.add(`@import ${JSON.stringify(urlToRequest(assetName))}`)
                      source.add('\n')
                      source.add(_source)
                      if (assets[item]._source) {
                        assets[item]._source = source
                      } else {
                        assets[item]._value = source.source()
                      }
                    }
                  })
                }
              })
            })
            return addRequireToSource(getIdOrName(chunk), modules, commonChunks)
          }
          if ((this.buildAdapter === BUILD_TYPES.QUICKAPP) &&
            (entryModule.miniType === META_TYPE.PAGE ||
            entryModule.miniType === META_TYPE.COMPONENT)) {
            return addRequireToSource(getIdOrName(chunk), modules, commonChunks)
          }
          if (typeof this.addChunkPages === 'function' && entryModule.miniType === META_TYPE.PAGE) {
            const id = getIdOrName(chunk)
            let source
            this.addChunkPages(addChunkPagesList, Array.from(pagesList).map((item: any) => item.name))
            addChunkPagesList.forEach((v, k) => {
              if (k === id) {
                source = addRequireToSource(id, modules, v.map(v => ({ name: v })))
              }
            })
            return source
          }
        }
      })
    })
  }
}

function getIdOrName (chunk: webpack.compilation.Chunk) {
  if (typeof chunk.id === 'string') {
    return chunk.id
  }
  return chunk.name
}

function addRequireToSource (id, modules, commonChunks) {
  const source = new ConcatSource()
  commonChunks.forEach(chunkItem => {
    source.add(`require(${JSON.stringify(promoteRelativePath(path.relative(id, chunkItem.name)))});\n`)
  })
  source.add('\n')
  source.add(modules)
  source.add(';')
  return source
}
