package com.test.catalog.infrastructure.adapters.storage;

import com.test.catalog.application.ports.ProductMediaStoragePort;
import com.test.shared.domain.valueobject.StoredObject;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * MinIO (S3-compatible) adapter for the "product-media" object store.
 *
 * derived_from: objectStorage:product-media
 *
 * Swap to AWS S3 / R2 / GCS-XML by changing storage.* config only — this code is
 * provider-agnostic (AWS SDK v2). visibility=public, urlAccess=public-url.
 */
@Component
public class ProductMediaMinioStorageAdapter implements ProductMediaStoragePort {

    private final S3Client s3Client;
    private final S3Presigner s3Presigner;

    @Value("${storage.buckets.product-media.bucket}")
    private String bucket;

    @Value("${storage.buckets.product-media.base-url}")
    private String baseUrl;

    @Value("${storage.buckets.product-media.signed-url-ttl:PT15M}")
    private String signedUrlTtl;

    public ProductMediaMinioStorageAdapter(S3Client s3Client, S3Presigner s3Presigner) {
        this.s3Client = s3Client;
        this.s3Presigner = s3Presigner;
    }

    @Override
    public StoredObject put(MultipartFile file) {
        String storageKey = UUID.randomUUID() + "/" + file.getOriginalFilename();
        String contentType = file.getContentType();
        try {
            s3Client.putObject(
                PutObjectRequest.builder().bucket(bucket).key(storageKey).contentType(contentType).build(),
                RequestBody.fromBytes(file.getBytes())
            );
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Failed to upload object to store 'product-media'", e);
        }

        URI url = URI.create(baseUrl + "/" + bucket + "/" + storageKey);
        return new StoredObject(storageKey, url, contentType, file.getSize());
    }

    @Override
    public URI signUrl(String storageKey) {
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
            .signatureDuration(Duration.parse(signedUrlTtl))
            .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(storageKey).build())
            .build();
        try {
            return s3Presigner.presignGetObject(presignRequest).url().toURI();
        } catch (URISyntaxException e) {
            throw new IllegalStateException("Failed to build signed URL for store 'product-media'", e);
        }
    }

    @Override
    public Resource get(String storageKey) {
        ResponseInputStream<GetObjectResponse> stream = s3Client.getObject(
            GetObjectRequest.builder().bucket(bucket).key(storageKey).build()
        );
        return new InputStreamResource(stream);
    }

    @Override
    public void delete(String storageKey) {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(storageKey).build());
    }
}
