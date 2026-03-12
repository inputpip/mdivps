SELECT branch_id, count(*) 
FROM deliveries 
WHERE driver_id = 'f8594c86-c9a7-44f7-88a9-b942dafad1e9' 
   OR helper_id = 'f8594c86-c9a7-44f7-88a9-b942dafad1e9' 
   OR helper_id_2 = 'f8594c86-c9a7-44f7-88a9-b942dafad1e9' 
   OR helper_id_3 = 'f8594c86-c9a7-44f7-88a9-b942dafad1e9'
GROUP BY branch_id;
