'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/spotlight-items',
      handler: 'spotlight-item.find',
      config: { policies: [] }
    },
    {
      method: 'GET',
      path: '/spotlight-items/:id',
      handler: 'spotlight-item.findOne',
      config: { policies: [] }
    }
  ]
};