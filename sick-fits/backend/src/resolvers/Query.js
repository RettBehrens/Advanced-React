const { forwardTo } = require('prisma-binding');
const { hasPermission } = require('../utils');
const Query = {
  items: forwardTo('db'),
  item: forwardTo('db'),
  itemsConnection: forwardTo('db'),
  me(parent, arguments, context, info) {
    if (!context.request.userId) {
      return null;
    }
    return context.db.query.user(
      {
        where: { id: context.request.userId }
      },
      info
    );
  },
  async users(parents, arguments, context, info) {
    if (!context.request.userId) {
      throw new Error('You must be logged in!');
    }
    hasPermission(context.request.user, ['ADMIN', 'PERMISSIONUPDATE']);
    return context.db.query.users({}, info);
  }
  //   async items(parent, arguments, context, info) {
  //     const items = await context.db.query.items();
  //     return items;
  //   }
};

module.exports = Query;
