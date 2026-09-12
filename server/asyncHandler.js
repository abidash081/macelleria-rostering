// Express 4 doesn't catch a rejected promise from an async route handler on
// its own - wrap every handler with this so a thrown/rejected error reaches
// next(err) (and our JSON error middleware) instead of hanging the request.
module.exports = function asyncHandler(fn) {
    return function (req, res, next) {
          Promise.resolve(fn(req, res, next)).catch(next);
    };
};
