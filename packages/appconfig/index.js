import {
  canPrefetch,
  createPrefetchClient,
  createClient,
  getCache,
  getInternal,
  processCache,
  modifyCache,
  jsonSafeParse
} from '@middy/util'
import {
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
  AppConfigDataClient
} from '@aws-sdk/client-appconfigdata'

const defaults = {
  AwsClient: AppConfigDataClient,
  awsClientOptions: {},
  awsClientAssumeRole: undefined,
  awsClientCapture: undefined,
  fetchData: {},
  disablePrefetch: false,
  cacheKey: 'appconfig',
  cacheExpiry: -1,
  setToContext: false
}
const contentTypePattern = /^application\/(.+\+)?json($|;.+)/
const appConfigMiddleware = (opts = {}) => {
  const options = {
    ...defaults,
    ...opts
  }
  const configurationTokenCache = {}
  const configurationCache = {}

  function fetchLatestConfiguration (configToken, internalKey) {
    return client
      .send(
        new GetLatestConfigurationCommand({
          ConfigurationToken: configToken
        })
      )
      .then((configResp) => {
        configurationTokenCache[internalKey] =
          configResp.NextPollConfigurationToken

        if (configResp.Configuration == null) {
          return configurationCache[internalKey]
        }

        let value = String.fromCharCode.apply(null, configResp.Configuration)
        if (contentTypePattern.test(configResp.ContentType)) {
          value = jsonSafeParse(value)
        }
        configurationCache[internalKey] = value
        return value
      })
      .catch((e) => {
        const value = getCache(options.cacheKey).value ?? {}
        value[internalKey] = undefined
        modifyCache(options.cacheKey, value)
        throw e
      })
  }

  const fetch = (request, cachedValues = {}) => {
    const values = {}
    for (const internalKey of Object.keys(options.fetchData)) {
      if (cachedValues[internalKey]) continue
      if (configurationTokenCache[internalKey] == null) {
        values[internalKey] = client
          .send(
            new StartConfigurationSessionCommand(options.fetchData[internalKey])
          )
          .then((configSessionResp) =>
            fetchLatestConfiguration(
              configSessionResp.InitialConfigurationToken,
              internalKey
            )
          )
          .catch((e) => {
            const value = getCache(options.cacheKey).value ?? {}
            value[internalKey] = undefined
            modifyCache(options.cacheKey, value)
            throw e
          })
        continue
      }
      values[internalKey] = fetchLatestConfiguration(
        configurationTokenCache[internalKey],
        internalKey
      )
    }
    return values
  }
  let prefetch, client
  if (canPrefetch(options)) {
    client = createPrefetchClient(options)
    prefetch = processCache(options, fetch)
  }
  const appConfigMiddlewareBefore = async (request) => {
    if (!client) {
      client = await createClient(options, request)
    }
    const { value } = prefetch ?? processCache(options, fetch, request)
    Object.assign(request.internal, value)
    if (options.setToContext) {
      const data = await getInternal(Object.keys(options.fetchData), request)
      Object.assign(request.context, data)
    }
    prefetch = null
  }
  return {
    before: appConfigMiddlewareBefore
  }
}
export default appConfigMiddleware

// # sourceMappingURL=index.js.map
