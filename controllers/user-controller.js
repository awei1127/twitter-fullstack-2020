const { Op } = require('sequelize') // 用「不等於」的條件查詢資料庫時需要用到的東西
const bcrypt = require('bcryptjs')
const db = require('../models')
const { imgurFileHandler } = require('../helpers/file-helpers')
const { User, Tweet, Followship, Like, Reply } = db
const helpers = require('../_helpers')

const userController = {
  // 取得註冊頁面
  signUpPage: (req, res) => {
    res.render('signup')
  },
  // 送出註冊資訊
  signUp: (req, res, next) => {
    // 取出註冊資訊
    const { account, name, email, password, checkPassword } = req.body
    // 準備裝錯誤訊息的陣列 為了同時顯示多個錯誤
    const errors = {}

    // 檢查註冊資訊是否正確 任一欄不得為空 密碼與確認密碼必須相同
    if (!account || !name || !email || !password || !checkPassword) {
      req.flash('error_messages', '所有欄位都是必填。')
      return res.render('signup', {
        errors,
        account,
        name,
        email,
        password,
        checkPassword
      })
    }
    if (password !== checkPassword) {
      errors.checkPassword = '密碼與確認密碼不一致。'
    }
    if (Object.keys(errors).length) {
      return res.render('signup', {
        errors,
        account,
        name,
        email,
        password,
        checkPassword
      })
    }
    // 檢查註冊資訊是否正確 前往資料庫查詢 非管理員的 account 或 email 是否已存在於資料庫
    return Promise.all([
      User.findOne({ where: { account, role: 'user' } }),
      User.findOne({ where: { email, role: 'user' } })
    ])
      .then(([accountUser, emailUser]) => {
        if (emailUser) {
          errors.email = 'email 已重複註冊！'
        }
        if (accountUser) {
          errors.account = 'account 已重複註冊！'
        }
        if (Object.keys(errors).length) {
          return res.render('signup', {
            errors,
            account,
            name,
            email,
            password,
            checkPassword
          })
        }
        return bcrypt.hash(password, 10)
          // 在資料庫創建User資料
          .then(hash => User.create({
            account,
            name,
            email,
            password: hash
          }))
          .then(() => {
            req.flash('success_messages', '成功註冊帳號。')
            res.redirect('/signin')
          })
          .catch(err => next(err))
      })
  },
  // 取得登入頁面
  signInPage: (req, res) => {
    res.render('signin')
  },
  // 送出登入資訊
  signIn: (req, res) => {
    res.redirect('/tweets')
  },
  // 登出
  logout: (req, res) => {
    req.logout()
    req.flash('success_messages', '你已成功登出。')
    res.redirect('/signin')
  },
  // API: 取得目前登入的使用者資料 只回傳json
  getUserData: (req, res, next) => {
    const userId = req.params.id
    // 檢查是不是自己本人
    if (Number(userId) !== helpers.getUser(req).id) {
      return res.json({
        status: 'error',
        message: 'Unauthorized operation. You can only access your own data.'
      })
    }
    User.findByPk(helpers.getUser(req).id, { raw: true })
      .then(user => {
        if (!user) throw new Error('User did not exist.')
        delete user.password // 刪除取得的password再回傳
        return res.json(user)
      })
      .catch(err => next(err))
  },
  // API: 送出編輯個人資料資訊
  editUserProfile: (req, res, next) => {
    const userId = req.params.id
    const { name, intro, coverReset } = req.body
    const avatarFile = req.files?.avatar ? req.files.avatar[0] : null // avatar是一個file的陣列，但裡面最多只會有1個file。file包含了上傳的檔案資訊
    const coverFile = req.files?.cover ? req.files.cover[0] : null // cover是一個file的陣列，但裡面最多只會有1個file。file包含了上傳的檔案資訊
    // 檢查是不是自己本人
    if (Number(userId) !== helpers.getUser(req).id) {
      return res.json({
        status: 'error',
        message: 'Unauthorized operation. You can only access your own data.'
      })
    }
    // 驗證name是否有值
    if (!name || name.trim() === '') throw new Error('Name is required.')
    // 驗證是否name不超過50字 且 intro不超過160字 (如果intro有值)
    if (name.length > 50 || intro ? intro.length > 160 : false) throw new Error('Limit exceeded.')
    // 把檔案上傳到imgur並回傳路徑 同時前往資料庫找user
    return Promise.all([
      imgurFileHandler(avatarFile),
      imgurFileHandler(coverFile),
      User.findByPk(helpers.getUser(req).id)
    ])
      .then(([avatarFilePath, coverFilePath, user]) => {
        if (!user) throw new Error('User did not exist.')
        if (coverReset === 'true') coverFilePath = 'https://i.imgur.com/b7U6LXD.jpg'
        return user.update({ name, intro: intro || user.intro, avatar: avatarFilePath || user.avatar, cover: coverFilePath || user.cover })
      })
      .then(user => {
        if (!user) throw new Error('User did not exist.')
        user = user.toJSON()
        delete user.password // 刪除取得的password再回傳
        return res.json(user)
      })
      .catch(err => next(err))
  },
  // 取得自己的帳戶設定頁面
  getSettingPage: (req, res, next) => {
    const userId = req.params.id
    // 檢查是不是自己本人
    if (Number(userId) !== helpers.getUser(req).id) throw new Error('Permission denied.')
    // 取得自己的帳戶資訊
    User.findByPk(userId, { raw: true })
      .then(user => {
        if (!user) throw new Error('User did not exist.')
        delete user.password // 刪除取得的password
        const currentUser = user
        const { account, name, email } = user
        res.render('setting', { account, name, email, userId, currentUser, isSetting: true, isHide: true }) // 左側欄設定頁籤選擇中，且隱藏右側欄
      })
      .catch(err => next(err))
  },
  // 送出帳戶設定資訊
  putSetting: (req, res, next) => {
    const userId = req.params.id
    const { account, name, email, password, checkPassword } = req.body
    const errors = []
    // 檢查是不是自己本人
    if (Number(userId) !== helpers.getUser(req).id) throw new Error('Permission denied.')
    // 檢查帳戶資訊是否正確 任一欄不得為空 密碼與確認密碼必須相同
    if (!account || !name || !email || !password || !checkPassword) {
      req.flash('error_messages', '所有欄位都是必填。')
      return res.render('setting', {
        errors,
        account,
        name,
        email,
        password,
        checkPassword
      })
    }
    if (password !== checkPassword) {
      errors.checkPassword = '密碼與確認密碼不一致。'
    }
    if (Object.keys(errors).length) {
      return res.render('setting', {
        userId,
        errors,
        account,
        name,
        email,
        isSetting: true,
        isHide: true
      }) // 左側欄設定頁籤選擇中，且隱藏右側欄
    }
    // 檢查帳戶資訊是否正確 資料庫中是否已經有非管理者使用了該 account 或 email
    return Promise.all([
      User.findOne({ where: { account, role: 'user', id: { [Op.ne]: userId } } }), // 尋找該account、排除管理員、排除自己
      User.findOne({ where: { email, role: 'user', id: { [Op.ne]: userId } } }) // 尋找該email、排除管理員、排除自己
    ])
      .then(([accountUser, emailUser]) => {
        if (emailUser) {
          errors.email = 'email 已重複註冊！'
        }
        if (accountUser) {
          errors.account = 'account 已重複註冊！'
        }
        if (Object.keys(errors).length) {
          return res.render('setting', {
            userId,
            errors,
            account,
            name,
            email,
            password,
            checkPassword,
            isSetting: true,
            isHide: true
          }) // 左側欄設定頁籤選擇中，且隱藏右側欄
        }
        // 取得自己的帳戶資訊 同時生成密碼
        return Promise.all([
          User.findByPk(userId),
          bcrypt.hash(password, 10)
        ])
          .then(([user, hash]) => {
            if (!user) throw new Error('User did not exist.')
            // 更新到資料庫
            return user.update({ account, name, email, password: hash })
          })
          .then(() => {
            req.flash('success_messages', '帳戶設定完成。')
            res.redirect(`/users/${userId}/setting`)
          })
          .catch(err => next(err))
      })
  },
  // 取得特定使用者所有推文頁面
  getUserTweetsPage: (req, res, next) => {
    const userId = req.params.id
    Promise.all([
      // 取得特定使用者 Id
      User.findByPk(userId, {
        nest: true,
        include: [
          { model: User, as: 'Followers' },
          { model: User, as: 'Followings' }
        ]
      }),
      // 取得該使用者所有貼文
      Tweet.findAll({
        where: { UserId: userId },
        order: [['createdAt', 'DESC']],
        include: [User],
        raw: true,
        nest: true
      }),
      Reply.findAll({
        attributes: ['tweetId'],
        raw: true
      }),
      Like.findAll({
        attributes: ['id', 'userId', 'tweetId'],
        raw: true,
        nest: true
      }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      })
    ])
      .then(([user, tweets, replies, likes, currentUser, topUsers]) => {
        const tweetsData = tweets.map(tweet => ({
          ...tweet,
          replyCount: replies.filter(reply => reply.tweetId === tweet.id).length,
          isLiked: likes.some(like => (like.userId === helpers.getUser(req).id && like.tweetId === tweet.id)),
          likeCount: likes.filter(like => like.tweetId === tweet.id).length
        }))
        // 將目前使用者追蹤的使用者做成一張清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        // 抓取特定使用者的資料
        const userData = ({
          ...user.toJSON(),
          isFollowed: followingList.includes(user.id),
          followerCount: user.Followings.length,
          followingCount: user.Followers.length
        })
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        const isProfile = currentUser.id === user.id
        res.render('userPage-tweets', { user: userData, tweets: tweetsData, currentUser, topUsers: data, isProfile })
      })
      .catch(err => next(err))
  },
  // 取得特定使用者所有回覆頁面
  getUserRepliesPage: (req, res, next) => {
    const userId = req.params.id
    Promise.all([
      // 取得特定使用者個人資料
      User.findByPk(userId, {
        nest: true,
        include: [
          { model: User, as: 'Followers' },
          { model: User, as: 'Followings' }
        ]
      }),
      // 取得特定使用者所有的回覆內容
      Reply.findAll({
        include: [
          { model: User, attributes: ['account', 'name', 'avatar', 'createdAt'] },
          { model: Tweet, attributes: [], include: [{ model: User, attributes: ['account'], raw: true, nest: true }] }
        ],
        where: { userId },
        order: [['createdAt', 'DESC']],
        raw: true,
        nest: true
      }),
      Tweet.findAll({ where: { userId } }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      })
    ])
      .then(([user, replies, tweets, currentUser, topUsers]) => {
        // 將目前使用者追蹤的使用者做成一張清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        user.isFollowed = followingList.includes(user.id)
        // 抓取特定使用者的資料
        const userData = ({
          ...user.toJSON(),
          isFollowed: followingList.includes(user.id),
          followerCount: user.Followings.length,
          followingCount: user.Followers.length
        })
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.render('userPage-replies', { user: userData, replies, tweets, currentUser, topUsers: data })
      })
  },
  // 取得特定使用者所有喜歡的內容頁面
  getUserLikesPage: (req, res, next) => {
    const userId = req.params.id
    Promise.all([
      // 取得特定使用者個人資料
      User.findByPk(userId, {
        nest: true,
        include: [
          { model: User, as: 'Followers' },
          { model: User, as: 'Followings' }
        ]
      }),
      // 取得該使用者喜歡的所有貼文
      Tweet.findAll({
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'description', 'createdAt'],
        include: [
          { model: User, attributes: ['id', 'account', 'name', 'avatar'] },
          { model: Like, where: { userId } }
        ],
        nest: true,
        raw: true
      }),
      Reply.findAll({
        attributes: ['tweetId'],
        raw: true
      }),
      Like.findAll({
        attributes: ['id', 'userId', 'tweetId', 'createdAt'],
        raw: true,
        nest: true
      }),
      // 取得該使用者所有貼文
      Tweet.findAll({ where: { userId } }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      })
    ])
      .then(([user, likedtweets, replies, likes, tweets, currentUser, topUsers]) => {
        // 新增 isLiked、likedTime 及計算 likeCount、replyCount
        const tweetsData = likedtweets
          .map(tweet => ({
            ...tweet,
            replyCount: replies.filter(reply => reply.tweetId === tweet.id).length,
            isLiked: likes.some(like => (like.userId === helpers.getUser(req).id && like.tweetId === tweet.id)),
            likeCount: likes.filter(like => like.tweetId === tweet.id).length,
            likedTime: likes.find(like => like.tweetId === tweet.id && like.userId === user.id)?.createdAt || null
          }))
          .sort((a, b) => b.likedTime - a.likedTime)
        // 將目前使用者追蹤的使用者做成一張清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        user.isFollowed = followingList.includes(user.id)
        // 抓取特定使用者的資料
        const userData = ({
          ...user.toJSON(),
          isFollowed: followingList.includes(user.id),
          followerCount: user.Followings.length,
          followingCount: user.Followers.length
        })
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.render('userPage-likes', { user: userData, likedtweets: tweetsData, tweets, currentUser, topUsers: data })
      })
      .catch(err => next(err))
  },
  // 追蹤特定使用者
  addFollow: (req, res, next) => {
    // 按鈕上這人的 id
    const userId = Number(req.body.id)

    // 自己不能追蹤自己(測試檔 redirect 需要 200)
    if (userId === helpers.getUser(req).id) {
      req.flash('error_messages', 'Cannot follow yourself!')
      return res.redirect(200, 'back')
    }

    return Promise.all([
      User.findByPk(userId),
      Followship.findOne({
        where: {
          followerId: helpers.getUser(req).id,
          followingId: userId
        }
      })
    ])
      .then(([user, followship]) => {
        if (!user) throw new Error('User did not exist.')
        if (followship) throw new Error('You have already followed this user!')
        return Followship.create({
          followerId: helpers.getUser(req).id,
          followingId: userId
        })
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },

  // 取消追蹤特定使用者
  removeFollow: (req, res, next) => {
    // 按鈕上這人的 id
    const userId = req.params.id
    return Followship.findOne({
      where: {
        followerId: helpers.getUser(req).id,
        followingId: userId
      }
    })
      .then(followship => {
        if (!followship) throw new Error("You haven't followed this user!")
        return followship.destroy()
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },
  // 取得特定使用者 Following(正在追蹤) 名單
  getUserFollowings: (req, res, next) => {
    return Promise.all([
      // 取得特定使用者個人資料
      User.findByPk(req.params.id, {
        include: [
          { model: User, as: 'Followings' },
          { model: User, as: 'Followers' },
          { model: Tweet }
        ],
        nest: true
      }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      })
    ])
      .then(([user, currentUser, topUsers]) => {
        if (!user) throw new Error('User not found')
        // 推文數量
        const tweetsLength = user.Tweets.length
        // 登入使用者目前的 following 清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        // 取出特定使用者 following 清單並和 登入使用者的 following 清單比對是否正在追蹤, 後排序
        const followings = user.toJSON().Followings
          .map(following => ({
            ...following,
            isFollowed: followingList.includes(following.id),
            isNotCurrentUser: following.id !== helpers.getUser(req).id
          }))
          .sort((a, b) => b.Followship.createdAt - a.Followship.createdAt)
        // 推薦跟隨名單, 和登入使用者的 followings 清單進行 isFollowed 比較
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.render('followship', { user: user.toJSON(), tweetsLength, currentUser, users: followings, topUsers: data, isFollowings: true })
      })
      .catch(err => next(err))
  },
  // 取得特定使用者 Follower(追隨者) 名單
  getUserFollowers: (req, res, next) => {
    return Promise.all([
      // 取得特定使用者個人資料
      User.findByPk(req.params.id, {
        include: [
          { model: User, as: 'Followings' },
          { model: User, as: 'Followers' },
          { model: Tweet }
        ],
        nest: true
      }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      })
    ])
      .then(([user, currentUser, topUsers]) => {
        if (!user) throw new Error('User not found')
        // 推文數量
        const tweetsLength = user.Tweets.length
        // 登入使用者目前的 following 清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        // 取出特定使用者 follower 清單並和 登入使用者的 following 清單比對是否正在追蹤, 後排序
        const followers = user.toJSON().Followers
          .map(follower => ({
            ...follower,
            isFollowed: followingList.includes(follower.id),
            isNotCurrentUser: follower.id !== helpers.getUser(req).id
          }))
          .sort((a, b) => b.Followship.createdAt - a.Followship.createdAt)
        console.log(followers)
        // 推薦跟隨名單, 和登入使用者的 followings 清單進行 isFollowed 比較
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.status(200).render('followship', { user: user.toJSON(), tweetsLength, currentUser, users: followers, topUsers: data, isFollowers: true })
      })
      .catch(err => next(err))
  }
}

module.exports = userController
