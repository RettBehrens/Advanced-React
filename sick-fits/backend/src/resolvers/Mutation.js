const Mutations = {
  async createItem(parent, arguments, context, info) {
    const item = await context.db.mutation.createItem(
      {
        data: {
          ...arguments
        }
      },
      info
    );
    return item;
  }
};

module.exports = Mutations;
