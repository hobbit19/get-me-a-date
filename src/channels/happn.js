/*
 * Copyright (c) 2017, Hugo Freire <hugo@exec.sh>.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable camelcase */

const HAPPN_FACEBOOK_LOGIN_APP_CLIENT_ID = '247294518656661'
const HAPPN_FACEBOOK_LOGIN_APP_REDIRECT_URI = 'https://www.happn.fr'
const HAPPN_FACEBOOK_LOGIN_APP_OPTIONAL_PARAMS = { scope: 'basic_info', response_type: 'token' }

const Channel = require('./channel')

const _ = require('lodash')
const Promise = require('bluebird')

const { NotAuthorizedError } = require('./errors')

const { HappnWrapper, HappnNotAuthorizedError } = require('happn-wrapper')

const { Channels } = require('../databases')

const defaultOptions = {
  oauth: {
    facebook: {
      clientId: HAPPN_FACEBOOK_LOGIN_APP_CLIENT_ID,
      redirectUri: HAPPN_FACEBOOK_LOGIN_APP_REDIRECT_URI,
      optionalParams: HAPPN_FACEBOOK_LOGIN_APP_OPTIONAL_PARAMS
    }
  },
  channel: { is_enabled: false }
}

class Happn extends Channel {
  constructor (options = {}) {
    super('happn')

    this._options = _.defaults(options, defaultOptions)

    this._happn = new HappnWrapper()
  }

  authorize () {
    return Channels.findByName(this.name)
      .then((channel) => {
        const authorize = function ({ facebookAccessToken }) {
          return this._happn.authorize(facebookAccessToken)
            .then(() => {
              return { user_id: this._happn.userId, token: this._happn.accessToken }
            })
        }

        return this.findOrAuthorizeIfNeeded(channel, authorize.bind(this))
          .then(({ user_id, token }) => {
            this._happn.userId = user_id
            this._happn.accessToken = token
          })
      })
  }

  getRecommendations () {
    return Promise.try(() => {
      if (!this._happn.accessToken) {
        throw new NotAuthorizedError()
      }
    })
      .then(() => this._happn.getRecommendations(16))
      .then(({ data }) => data)
      .mapSeries((data) => {
        return {
          channel: 'happn',
          channel_id: data.notifier.id,
          name: data.notifier.first_name,
          photos: _.map(data.notifier.profiles, (photo) => _.pick(photo, [ 'url', 'id' ])),
          data
        }
      })
      .catch(HappnNotAuthorizedError, () => this.onNotAuthorizedError.bind(this)())
  }

  getUpdates () {
    const getUpdates = (limit, offset, lastActivityDate, updates) => {
      return this._happn.getUpdates(limit, offset)
        .then(({ matches }) => {
          if (_.isEmpty(matches.data) || new Date(matches.data[ 0 ].creation_date).getTime() < lastActivityDate.getTime()) {
            return updates
          }

          _.forEach(matches.data, (match) => {
            if (new Date(match.creation_date).getTime() > lastActivityDate.getTime()) {
              updates.matches.push(match)
            }
          })

          if (new Date(matches.data[ matches.data.length - 1 ].creation_date).getTime() > lastActivityDate.getTime()) {
            return getUpdates(limit, offset + limit, lastActivityDate, updates)
          }

          return updates
        })
    }

    return Promise.try(() => {
      if (!this._happn.accessToken) {
        throw new NotAuthorizedError()
      }
    })
      .then(() => Channels.findByName(this.name))
      .then(({ last_activity_date }) => {
        const lastActivityDate = !last_activity_date ? undefined : last_activity_date

        return getUpdates(10, 0, lastActivityDate, { matches: [], conversations: [] })
      })
      .then(({ matches, conversations }) => {
        const last_activity_date = new Date()

        return Channels.save([ this.name ], { last_activity_date })
          .then(() => {
            return Promise.mapSeries(matches, (match) => {
              return {
                isNewMatch: true,
                recommendation: {
                  channel: 'happn',
                  channel_id: match.notifier.id,
                  name: match.notifier.first_name,
                  photos: _.map(match.notifier.profiles, (photo) => _.pick(photo, [ 'url', 'id' ])),
                  match_id: match.notifier.id,
                  data: match.notifier
                },
                messages: []
              }
            })
          })
      })
      .catch(HappnNotAuthorizedError, () => this.onNotAuthorizedError.bind(this)())
  }

  like (userId) {
    if (!userId) {
      return Promise.reject(new Error('invalid arguments'))
    }

    return Promise.try(() => {
      if (!this._happn.accessToken) {
        throw new NotAuthorizedError()
      }
    })
      .then(() => this._happn.like(userId))
      .then(() => this._happn.getUser(userId))
      .then(({ data }) => {
        if (data.my_relation === 4) {
          return {
            channel: 'happn',
            channel_id: data.id,
            name: data.first_name,
            photos: _.map(data.notifier.profiles, (photo) => _.pick(photo, [ 'url', 'id' ])),
            data
          }
        }
      })
      .catch(HappnNotAuthorizedError, () => this.onNotAuthorizedError.bind(this)())
  }

  getUser (userId) {
    if (!userId) {
      return Promise.reject(new Error('invalid arguments'))
    }

    return Promise.try(() => {
      if (!this._happn.accessToken) {
        throw new NotAuthorizedError()
      }
    })
      .then(() => this._happn.getUser(userId))
      .then(({ data }) => {
        return {
          channel: 'happn',
          channel_id: data.id,
          name: data.first_name,
          photos: _.map(data.notifier.profiles, (photo) => _.pick(photo, [ 'url', 'id' ])),
          data
        }
      })
      .catch(HappnNotAuthorizedError, () => this.onNotAuthorizedError.bind(this)())
  }

  onNotAuthorizedError () {
    this._happn.accessToken = undefined
    this._happn.refreshToken = undefined
    this._happn.userId = undefined

    return super.onNotAuthorizedError()
  }
}

module.exports = new Happn()