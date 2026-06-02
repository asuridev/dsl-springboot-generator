package com.test.shared.domain.interfaces;

public interface ReturningCommandHandler<C extends ReturningCommand<R>, R> extends Handler {
    R handle(C command);
}
