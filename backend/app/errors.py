"""Typed error hierarchy shared by the provider layer and the HTTP API."""

from __future__ import annotations


class AppError(Exception):
    """Base class for errors that map cleanly onto an HTTP response."""

    status_code = 500
    code = "internal_error"
    retryable = False


class BadRequestError(AppError):
    """The request itself is malformed (bad playlist link, empty name, ...)."""

    status_code = 400
    code = "invalid_request"

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ProviderError(AppError):
    """The upstream music source failed (rate limit, scraper breakage, ...)."""

    status_code = 502
    code = "provider_error"

    def __init__(self, message: str, *, retryable: bool = True, code: str | None = None):
        super().__init__(message)
        self.retryable = retryable
        if code:
            self.code = code
