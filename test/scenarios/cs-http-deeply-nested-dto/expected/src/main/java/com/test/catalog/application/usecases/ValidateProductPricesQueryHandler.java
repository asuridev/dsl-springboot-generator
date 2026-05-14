package com.test.catalog.application.usecases;

import com.test.catalog.application.dtos.ProductPriceValidationResultDto;
import com.test.catalog.application.queries.ValidateProductPricesQuery;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[validate-product-prices]
@ApplicationComponent
public class ValidateProductPricesQueryHandler
    implements QueryHandler<ValidateProductPricesQuery, ProductPriceValidationResultDto>
{

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductPriceValidationResultDto handle(ValidateProductPricesQuery query) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
